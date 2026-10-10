import type { Anchor, NormalizedRect, Viewport } from "@mf100/domain";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { M3eIconButton, M3eIcon } from "@/ui/m3e";
import { AnchorOverlay, type OverlayThread } from "./AnchorOverlay";

// Vite がワーカーを別チャンクとして配信する
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface Props {
  blob: Blob;
  artifactId: string;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  selecting: boolean;
  draft: { page: number; rect?: NormalizedRect; point?: { x: number; y: number } } | null;
  onDraft: (
    d: { page: number; rect?: NormalizedRect; point?: { x: number; y: number } } | null,
  ) => void;
  /** 指摘カードから「位置へ移動」したときのページ移動要求 */
  requestedPage: number | null;
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
  requestedPage,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void blob.arrayBuffer().then((data) =>
      pdfjs
        .getDocument({ data })
        .promise.then((d) => {
          if (!cancelled) setDoc(d);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "PDF を読み込めません")),
    );
    return () => {
      cancelled = true;
    };
  }, [blob]);

  useEffect(() => {
    if (requestedPage && requestedPage !== page) setPage(requestedPage);
  }, [requestedPage]);

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    void doc.getPage(page).then(async (p) => {
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

  const pageCount = doc?.numPages ?? 0;
  const pageThreads = threads.filter(
    (t) =>
      (t.anchor.type === "pdf_rect" || t.anchor.type === "pdf_pin") &&
      t.anchor.artifactId === artifactId &&
      t.anchor.page === page,
  );

  return (
    <div className="viewer">
      <div className="viewer__toolbar" role="toolbar" aria-label="PDF 操作">
        <M3eIconButton
          aria-label="前のページ"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <M3eIcon name="chevron_left" />
        </M3eIconButton>
        <span className="small">{pageCount ? `${page} / ${pageCount} ページ` : "読込中…"}</span>
        <M3eIconButton
          aria-label="次のページ"
          disabled={page >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
        >
          <M3eIcon name="chevron_right" />
        </M3eIconButton>
        <M3eIconButton aria-label="縮小" onClick={() => setScale((s) => Math.max(0.4, s - 0.2))}>
          <M3eIcon name="zoom_out" />
        </M3eIconButton>
        <span className="small">{Math.round(scale * 100)}%</span>
        <M3eIconButton aria-label="拡大" onClick={() => setScale((s) => Math.min(4, s + 0.2))}>
          <M3eIcon name="zoom_in" />
        </M3eIconButton>
        <M3eIconButton
          aria-label="右に回転"
          onClick={() => setRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270)}
        >
          <M3eIcon name="rotate_right" />
        </M3eIconButton>
        {selecting ? (
          <span className="chip chip--warn">ドラッグで範囲、クリックでピンを指定</span>
        ) : null}
      </div>
      {error ? <div className="alert">{error}</div> : null}
      <div className="viewer__stage">
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
        </div>
      </div>
    </div>
  );
}

export function anchorPage(anchor: Anchor): number | null {
  return anchor.type === "pdf_rect" || anchor.type === "pdf_pin" ? anchor.page : null;
}
