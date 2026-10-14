import type { Anchor, NormalizedRect, Viewport } from "@mf100/domain";
import type { PDFDocumentProxy } from "pdfjs-dist";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnchorOverlay, type OverlayThread } from "./AnchorOverlay";
import { useStageWidth } from "./useStageWidth";

// Vite がワーカーを別チャンクとして配信する
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export type PdfDraft = { page: number; rect?: NormalizedRect; point?: { x: number; y: number } };

/** 表示位置: ページと、ページ上端からの割合（舞台の上から 40% の線） */
export interface ViewPosition {
  page: number;
  rel: number;
}

/** 版比較のスクロール同期で親が使う操作 */
export interface PdfViewerController {
  getPosition: () => ViewPosition | null;
  /** その位置を舞台の 40% の線に合わせる。このスクロールは onUserScroll に通知しない */
  scrollToPosition: (pos: ViewPosition) => void;
}

/** PDF.js の倍率 1 は 1pt = 1px。Acrobat などの「100%」（実寸）は 96 / 72 倍 */
export const PDF_ACTUAL_SIZE = 96 / 72;

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
  /** 表示中のページ。親が変えるとそのページまで送る。読み手がスクロールすると `onPageChange` で返す */
  page: number;
  onPageChange?: (n: number) => void;
  /** 幅に合わせた大きさに掛ける倍率（1 ＝ 左右の余白が同じになる幅） */
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  /** 紙面の横に並べる列（Google ドキュメント式のコメント）の幅＋間隔。幅合わせから差し引く */
  besideWidth?: number;
  onPageCount?: (n: number) => void;
  /** 実寸に対する表示倍率（1 ＝ 100%）を返す。ツールバーの数値表示用 */
  onZoom?: (actual: number) => void;
  /** ページの上に重ねるもの（投稿欄・吹き出し）。座標は viewport px */
  renderInPage?: (vp: Viewport, page: number) => ReactNode;
  /** ページの右に並べるもの（Google ドキュメント式に整列したコメント） */
  renderGutter?: (vp: Viewport, page: number) => ReactNode;
  /** 読み込んだ PDF を親と共有する（版比較の特徴抽出で同じ文書を使い、二重に読まない） */
  onDoc?: (doc: PDFDocumentProxy) => void;
  /** 版比較: 親がスクロール位置を読み書きする */
  controller?: { current: PdfViewerController | null };
  /** 版比較: 利用者がスクロールしたとき（プログラムからのスクロールでは呼ばない） */
  onUserScroll?: (pos: ViewPosition) => void;
}

type Size = { w: number; h: number };

/**
 * PDF.js ビューア（F-06 / U-05）。全ページを縦に連続して並べ、画面に近いページだけを描画する。
 * 最初は紙面の幅を舞台の内容幅に合わせ（左右の余白が同じ）、`scale` はその上に掛かる。
 * 指摘はページ番号＋正規化座標で保存し、倍率・回転・ビューポート幅に依存しない（A-03）。
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
  onPageChange,
  scale,
  rotation,
  besideWidth = 0,
  onPageCount,
  onZoom,
  renderInPage,
  renderGutter,
  onDoc,
  controller,
  onUserScroll,
}: Props) {
  const [stageRef, stageWidth] = useStageWidth<HTMLDivElement>(true);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  /** 各ページの倍率 1 の大きさ（回転込み） */
  const [sizes, setSizes] = useState<Size[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pageEls = useRef<Array<HTMLDivElement | null>>([]);
  const shown = useRef(1);
  const ratio = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setSizes([]);
    // 添付・版が替わったら先頭から
    shown.current = 1;
    ratio.current = 0;
    if (stageRef.current) stageRef.current.scrollTop = 0;
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
          onDoc?.(d);
          onPageCount?.(d.numPages);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "PDF を読み込めません")),
    );
    return () => {
      cancelled = true;
    };
  }, [blob]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    void Promise.all(
      Array.from({ length: doc.numPages }, (_, i) =>
        doc.getPage(i + 1).then((p) => {
          const vp = p.getViewport({ scale: 1, rotation: (p.rotate + rotation) % 360 });
          return { w: vp.width, h: vp.height };
        }),
      ),
    ).then((s) => {
      if (!cancelled) setSizes(s);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, rotation]);

  // 幅合わせ: いちばん幅の広いページが、舞台の内容幅（横の列を除く）にちょうど収まる倍率
  const widest = sizes.reduce((m, s) => Math.max(m, s.w), 0);
  const fit = widest > 0 && stageWidth > 0 ? Math.max(0.1, (stageWidth - besideWidth) / widest) : 0;
  const renderScale = fit * scale;
  useEffect(() => {
    if (renderScale > 0) onZoom?.(renderScale / PDF_ACTUAL_SIZE);
  }, [renderScale]);

  // プログラムからのスクロール（同期）の間は利用者のスクロールとして扱わない（同期のループを防ぐ）
  const programmatic = useRef(0);
  const position = (): ViewPosition | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const line = stage.getBoundingClientRect().top + stage.clientHeight * 0.4;
    for (let i = 0; i < pageEls.current.length; i++) {
      const el = pageEls.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const next = pageEls.current[i + 1]?.getBoundingClientRect();
      if (line < r.bottom || !next || line < next.top)
        return {
          page: i + 1,
          rel: Math.min(1, Math.max(0, (line - r.top) / Math.max(1, r.height))),
        };
    }
    return null;
  };
  if (controller)
    controller.current = {
      getPosition: position,
      scrollToPosition: (pos) => {
        const stage = stageRef.current;
        const el = pageEls.current[pos.page - 1];
        if (!stage || !el) return;
        const r = el.getBoundingClientRect();
        const line = stage.getBoundingClientRect().top + stage.clientHeight * 0.4;
        programmatic.current = performance.now();
        stage.scrollTop += r.top + pos.rel * r.height - line;
      },
    };

  // 倍率が変わっても読んでいた位置（縦の割合）を保つ
  const onScroll = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (onUserScroll && performance.now() - programmatic.current > 120) {
      const pos = position();
      if (pos) onUserScroll(pos);
    }
    ratio.current = stage.scrollHeight > 0 ? stage.scrollTop / stage.scrollHeight : 0;
    // 舞台の上から 40% の線にかかっているページを「表示中」とする
    const line = stage.getBoundingClientRect().top + stage.clientHeight * 0.4;
    let n = 1;
    pageEls.current.forEach((el, i) => {
      if (el && el.getBoundingClientRect().top <= line) n = i + 1;
    });
    if (n !== shown.current) {
      shown.current = n;
      onPageChange?.(n);
    }
  };
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage && renderScale > 0) stage.scrollTop = ratio.current * stage.scrollHeight;
  }, [renderScale]);

  // 親がページを変えた（ページ送り・コメントへの移動・比較の相手）ときだけ、そのページまで送る
  useEffect(() => {
    const stage = stageRef.current;
    const el = pageEls.current[page - 1];
    if (!stage || !el || page === shown.current) return;
    shown.current = page;
    stage.scrollTop += el.getBoundingClientRect().top - stage.getBoundingClientRect().top - 24;
  }, [page, sizes.length, renderScale > 0]);

  return (
    <div className="viewer">
      {error ? <div className="alert">{error}</div> : null}
      <div className="viewer__stage" tabIndex={0} ref={stageRef} onScroll={onScroll}>
        {doc && renderScale > 0 ? (
          <div className="viewer__pages">
            {sizes.map((s, i) => {
              const n = i + 1;
              const viewport: Viewport = {
                width: s.w * renderScale,
                height: s.h * renderScale,
                rotation,
              };
              return (
                <div className="viewer__row" key={n}>
                  <div
                    className="viewer__page"
                    data-page={n}
                    ref={(el) => {
                      pageEls.current[i] = el;
                    }}
                    style={{ width: viewport.width, height: viewport.height }}
                  >
                    <PdfCanvas
                      doc={doc}
                      n={n}
                      scale={renderScale}
                      rotation={rotation}
                      root={stageRef}
                    />
                    <AnchorOverlay
                      viewport={viewport}
                      threads={threads.filter(
                        (t) =>
                          (t.anchor.type === "pdf_rect" || t.anchor.type === "pdf_pin") &&
                          t.anchor.artifactId === artifactId &&
                          t.anchor.page === n,
                      )}
                      activeThreadId={activeThreadId}
                      onSelectThread={onSelectThread}
                      selecting={selecting}
                      draft={draft && draft.page === n ? draft : null}
                      onDraft={(d) => onDraft({ page: n, ...d })}
                    />
                    {renderInPage?.(viewport, n)}
                  </div>
                  {renderGutter?.(viewport, n)}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 1 ページ分の canvas。舞台の近く（上下 1 画面分）に来たら描き、離れたら捨ててメモリを空ける */
function PdfCanvas({
  doc,
  n,
  scale,
  rotation,
  root,
}: {
  doc: PDFDocumentProxy;
  n: number;
  scale: number;
  rotation: number;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e?.isIntersecting ?? false), {
      root: root.current,
      rootMargin: "100% 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (!near) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    void doc.getPage(n).then(async (p) => {
      if (cancelled) return;
      const vp = p.getViewport({ scale, rotation: (p.rotate + rotation) % 360 });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 倍率が続けて変わると前の描画が走ったままになるので、同じ canvas への二重描画を避けて前の描画を止める
      task = p.render({ canvas, canvasContext: ctx, viewport: vp });
      try {
        await task.promise;
      } catch {
        // 取り消し
      }
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, scale, rotation, near]);

  return <canvas ref={ref} aria-label={`PDF ${n} ページ目`} />;
}

export function anchorPage(anchor: Anchor): number | null {
  return anchor.type === "pdf_rect" || anchor.type === "pdf_pin" ? anchor.page : null;
}
