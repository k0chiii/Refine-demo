import type { Anchor, NormalizedRect, Viewport } from "@mf100/domain";
import type { PDFDocumentProxy } from "pdfjs-dist";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnchorOverlay, type OverlayThread } from "./AnchorOverlay";

// Vite がワーカーを別チャンクとして配信する
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export type PdfDraft = { page: number; rect?: NormalizedRect; point?: { x: number; y: number } };

interface Props {
  blob: Blob;
  artifactId: string;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  /** ドラッグで範囲、クリックでピンを指定できるか（投稿権限があれば常時） */
  selecting: boolean;
  draft: PdfDraft | null;
  onDraft: (d: PdfDraft | null) => void;
  /** 表示状態は親（フローティングツールバー）が持つ */
  page: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  onPageCount?: (n: number) => void;
  /** ページの上に重ねるもの（投稿欄・吹き出し）。座標は viewport px */
  renderInPage?: (vp: Viewport) => ReactNode;
  /** ページの右に並べるもの（Google ドキュメント式に整列したコメント） */
  renderGutter?: (vp: Viewport) => ReactNode;
}

/**
 * PDF.js ビューア（F-06 / U-05）。ページ番号＋正規化座標で保存し、倍率・回転・ビューポート幅に依存しない（A-03）。
 */
export function PdfViewer({
  blob,
  artifactId,
  threads,
  activeThreadId,
  onSelectThread,
  selecting,
  draft,
  onDraft,
  page,
  scale,
  rotation,
  onPageCount,
  renderInPage,
  renderGutter,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void blob.arrayBuffer().then((data) =>
      pdfjs
        .getDocument({
          data,
          cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
          useSystemFonts: true,
        })
        .promise.then((d) => {
          if (cancelled) return;
          setDoc(d);
          onPageCount?.(d.numPages);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "PDF を読み込めません")),
    );
    return () => {
      cancelled = true;
    };
  }, [blob]);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    const n = Math.min(Math.max(1, page), doc.numPages);
    void doc.getPage(n).then(async (p) => {
      if (cancelled) return;
      const vp = p.getViewport({ scale, rotation: (p.rotate + rotation) % 360 });
      const canvas = canvasRef.current!;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      if (!cancelled) setViewport({ width: vp.width, height: vp.height, rotation });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, page, scale, rotation]);

  const pageThreads = threads.filter(
    (t) =>
      (t.anchor.type === "pdf_rect" || t.anchor.type === "pdf_pin") &&
      t.anchor.artifactId === artifactId &&
      t.anchor.page === page,
  );

  return (
    <div className="viewer">
      {error ? <div className="alert">{error}</div> : null}
      <div className="viewer__stage" tabIndex={0}>
        <div className="viewer__page">
          <canvas ref={canvasRef} aria-label={`PDF ${page} ページ目`} />
          {viewport ? (
            <AnchorOverlay
              viewport={viewport}
              threads={pageThreads}
              activeThreadId={activeThreadId}
              onSelectThread={onSelectThread}
              selecting={selecting}
              draft={draft && draft.page === page ? draft : null}
              onDraft={(d) => onDraft({ page, ...d })}
            />
          ) : null}
          {viewport ? renderInPage?.(viewport) : null}
        </div>
        {viewport && renderGutter ? renderGutter(viewport) : null}
      </div>
    </div>
  );
}

export function anchorPage(anchor: Anchor): number | null {
  return anchor.type === "pdf_rect" || anchor.type === "pdf_pin" ? anchor.page : null;
}
