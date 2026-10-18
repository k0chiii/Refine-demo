import type { NormalizedRect, Viewport } from "@mf100/domain";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnchorOverlay, type OverlayThread } from "./AnchorOverlay";
import { PdfLinks } from "./PdfLinks";
import { PdfTextLayer } from "./PdfTextLayer";
import type { ArtifactDownload } from "@/lib/artifactFiles";
import { openPdfFromDownload, pdfDocumentParams, pdfjs } from "./pdfjs";
import { useStageWidth } from "./useStageWidth";
import { useViewerSync, type ViewerSyncProps } from "./viewerSync";

export type PdfDraft = { page: number; rect?: NormalizedRect; point?: { x: number; y: number } };

/**
 * 1 枚の canvas の画素数の上限（利用者指示 2026-10-17「少し画質荒くなってもいい」）。これを超える拡大は画素密度を下げて描き、
 * CSS（canvas は 100% 幅）で引き伸ばす（少し粗くなる）。大きく拡大するほど 1 ページ全体を描き直す時間と、canvas のメモリ
 * （1 枚 4 バイト × 画素数）が大きくなるので、iOS の上限（1,600 万画素前後）より小さく抑える
 */
export const MAX_CANVAS_PIXELS = 8_000_000;
/** 拡大の上限（実寸比。1 ＝ 100%）。1000% */
export const PDF_MAX_ZOOM = 10;
/** 紙面の 1 辺の CSS 長さの上限（px）。ブラウザの要素の大きさの上限（Chrome 約 3,350 万、Safari はさらに小さい）より手前で止める */
export const PDF_MAX_CSS_PX = 32_000;

/** 画素密度の上限つきの描画密度。dpr を基準に、1 枚の画素数が max を超えないよう下げる（CSS の大きさは変えない） */
export function canvasDensity(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  maxPixels = MAX_CANVAS_PIXELS,
): number {
  return Math.min(dpr, Math.sqrt(maxPixels / Math.max(1, cssWidth * cssHeight)));
}

/** PDF.js の倍率 1 は 1pt = 1px。Acrobat などの「100%」（実寸）は 96 / 72 倍 */
export const PDF_ACTUAL_SIZE = 96 / 72;

interface Props extends ViewerSyncProps {
  /** 全部取得済みのファイル。取得中のものは download（受け取りながら開く。先頭の数百 KB で 1 ページ目を描ける） */
  blob?: Blob | null;
  download?: ArtifactDownload | null;
  artifactId: string;
  threads: OverlayThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  /** ドラッグで範囲、クリックでピンを指定できるか（投稿権限があれば常時） */
  selecting: boolean;
  /**
   * 印を付けないとき（書き込み「なし」）: 紙面そのものを押せるようにする。印の層は押す・なぞるを通し（印そのものは押せる）、
   * PDF の中のリンクを `<a>` として出し（外部 URL は新しいタブ、ページ内のリンクはそのページへ）、文字の層（PdfTextLayer）で
   * 文字を選んでコピーできる。コメント・FB のモードでは出さない
   */
  passive?: boolean;
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
  /**
   * 実寸に対する表示倍率（1 ＝ 100%）を返す。ツールバーの数値表示用。
   * limits: 幅に合わせた大きさ（scale 1）の実寸比 `fit` と、拡大の上限の実寸比 `max`（PDF_MAX_ZOOM と紙面の大きさの上限の小さい方）。
   * 親は scale の上限を max / fit にする（拡大縮小のたびに state の倍率から割り戻すと、描き直す前の古い値に当たるため）
   */
  onZoom?: (actual: number, limits?: { fit: number; max: number }) => void;
  /** ページの上に重ねるもの（投稿欄・吹き出し）。座標は viewport px */
  renderInPage?: (vp: Viewport, page: number) => ReactNode;
  /** ページの右に並べるもの（Google ドキュメント式に整列したコメント） */
  renderGutter?: (vp: Viewport, page: number) => ReactNode;
  /** 読み込んだ PDF を親と共有する（版比較の特徴抽出で同じ文書を使い、二重に読まない） */
  onDoc?: (doc: PDFDocumentProxy) => void;
  /**
   * 最初に画面に出るページを描き終えた（失敗して代わりのメッセージを出すときも）。親は、これが届くまで紙面を隠し、読み込み中の
   * 指標をひとつだけ出して、届いたら紙面・指摘の印・文字をいっぺんに出す（読み込みの途中の姿を見せない。docs/UI_M3E.md §65）
   */
  onReady?: () => void;
}

type Size = { w: number; h: number };

/**
 * PDF.js ビューア（F-06 / U-05）。全ページを縦に連続して並べ、画面に近いページだけを描画する。
 * 最初は紙面の幅を舞台の内容幅に合わせ（左右の余白が同じ）、`scale` はその上に掛かる。
 * 指摘はページ番号＋正規化座標で保存し、倍率・回転・ビューポート幅に依存しない（A-03）。
 */
export function PdfViewer({
  blob,
  download,
  artifactId,
  threads,
  activeThreadId,
  onSelectThread,
  selecting,
  passive = false,
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
  onReady,
  ...sync
}: Props) {
  const [stageRef, stageWidth] = useStageWidth<HTMLDivElement>(true);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  /** 各ページの倍率 1 の大きさ（回転込み） */
  const [sizes, setSizes] = useState<Size[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pageEls = useRef<Array<HTMLDivElement | null>>([]);
  const shown = useRef(1);
  const ratio = useRef(0);
  // 最初に画面に出るページ（舞台の近くにあるもの）を全部描き終えたら、親へ一度だけ知らせる（添付が替わったらまた）。
  // 1 枚だけ先に出して残りが後から埋まる（2 枚目が白いまま指摘の印だけ見える）のを避ける
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const notified = useRef(false);
  const near = useRef(new Set<number>());
  const done = useRef(new Set<number>());
  const notifyReady = useCallback(() => {
    if (notified.current) return;
    notified.current = true;
    readyRef.current?.();
  }, []);
  const check = useCallback(() => {
    if (near.current.size > 0 && [...near.current].every((n) => done.current.has(n))) notifyReady();
  }, [notifyReady]);
  const onNear = useCallback(
    (n: number, isNear: boolean) => {
      if (isNear) near.current.add(n);
      else near.current.delete(n);
      check();
    },
    [check],
  );
  const onPainted = useCallback(
    (n: number) => {
      done.current.add(n);
      check();
    },
    [check],
  );

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setSizes([]);
    notified.current = false;
    near.current.clear();
    done.current.clear();
    // 添付・版が替わったら先頭から
    shown.current = 1;
    ratio.current = 0;
    if (stageRef.current) stageRef.current.scrollTop = 0;
    const fail = () => {
      if (cancelled) return;
      setError("PDF を読み込めませんでした。ファイルが壊れていないか確かめてください。");
      notifyReady();
    };
    void (async () => {
      try {
        const task = download
          ? await openPdfFromDownload(download, fail)
          : pdfjs.getDocument({
              data: await blob!.arrayBuffer(),
              ...pdfDocumentParams,
            });
        const d = await task.promise;
        if (cancelled) return;
        setDoc(d);
        onDoc?.(d);
        onPageCount?.(d.numPages);
      } catch {
        fail();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, download]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let settled = false;
    const sizeOf = (p: PDFPageProxy) => {
      const vp = p.getViewport({ scale: 1, rotation: (p.rotate + rotation) % 360 });
      return { w: vp.width, h: vp.height };
    };
    // 全ページの大きさが分かるのを待たずに、1 ページ目の大きさで仮の並びを作って描き始める（受け取りながら開いた PDF では、
    // 全ページの定義を読むのに離れた箇所の取得が要る）。全ページ分が揃ったら実際の大きさに置き換える（ふつうは同じ）
    void doc.getPage(1).then((p) => {
      if (!cancelled && !settled) setSizes(Array.from({ length: doc.numPages }, () => sizeOf(p)));
    });
    // 受け取り中は、残りのページの定義を読みに行かない（読むために離れた箇所の取得が走り、受け取りと帯域を取り合う）。
    // 全部届いてから実際の大きさに置き換える。画面に出るページは PdfCanvas が必要に応じて読む
    const delivered = download && !download.completed ? download.blob : Promise.resolve(null);
    void delivered
      .then(() =>
        Promise.all(
          Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1).then(sizeOf)),
        ),
      )
      .then((s) => {
        settled = true;
        if (!cancelled) setSizes(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [doc, rotation]);

  // 幅合わせ: いちばん幅の広いページが、舞台の内容幅（横の列を除く）にちょうど収まる倍率
  const widest = sizes.reduce((m, s) => Math.max(m, s.w), 0);
  const fit = widest > 0 && stageWidth > 0 ? Math.max(0.1, (stageWidth - besideWidth) / widest) : 0;
  const renderScale = fit * scale;
  const longest = sizes.reduce((m, s) => Math.max(m, s.w, s.h), 0);
  useEffect(() => {
    if (renderScale > 0)
      onZoom?.(renderScale / PDF_ACTUAL_SIZE, {
        fit: fit / PDF_ACTUAL_SIZE,
        max: Math.min(PDF_MAX_ZOOM, PDF_MAX_CSS_PX / Math.max(1, longest * PDF_ACTUAL_SIZE)),
      });
  }, [renderScale]);

  // 倍率が変わったら焦点（ピンチの指・ポインタ、ボタンは舞台の中央）の下の箇所を縦・横とも同じ画面位置に保つ。
  // 版比較の同期（縦・横）もここ。初回の描画など焦点を保てないときは、読んでいた縦の割合を保つ
  const { onScroll: onSyncScroll } = useViewerSync(
    stageRef,
    renderScale,
    () => pageEls.current,
    sync,
    () => {
      const stage = stageRef.current;
      if (stage && renderScale > 0) stage.scrollTop = ratio.current * stage.scrollHeight;
    },
  );

  const onScroll = () => {
    const stage = stageRef.current;
    if (!stage) return;
    onSyncScroll();
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
  /** リンクの移動先のページへ送る（いまのページへのリンクでも、そのページの先頭へ） */
  const goToPage = (n: number) => {
    const stage = stageRef.current;
    const el = pageEls.current[n - 1];
    if (!stage || !el) return;
    shown.current = n;
    stage.scrollTop += el.getBoundingClientRect().top - stage.getBoundingClientRect().top - 24;
    onPageChange?.(n);
  };
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
                      onNear={onNear}
                      onPainted={onPainted}
                    />
                    {passive ? (
                      <PdfTextLayer
                        doc={doc}
                        n={n}
                        scale={renderScale}
                        rotation={rotation}
                        root={stageRef}
                      />
                    ) : null}
                    {passive ? (
                      <PdfLinks
                        doc={doc}
                        n={n}
                        rotation={rotation}
                        numPages={sizes.length}
                        onGoto={goToPage}
                      />
                    ) : null}
                    <AnchorOverlay
                      passive={passive}
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
  onNear,
  onPainted,
}: {
  doc: PDFDocumentProxy;
  n: number;
  scale: number;
  rotation: number;
  root: React.RefObject<HTMLDivElement | null>;
  /** 舞台の近く（描く対象）に入った・出た */
  onNear?: (n: number, near: boolean) => void;
  /** 描き終えた（取り消されたものは含まない。描けなかったときも「済んだ」として知らせる） */
  onPainted?: (n: number) => void;
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
    onNear?.(n, near);
    return () => onNear?.(n, false);
  }, [n, near, onNear]);

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
      // 大きく拡大したとき canvas が上限（MAX_CANVAS_PIXELS）を超えないよう、画素密度を下げる（CSS の大きさはそのまま。少し粗くなる）
      const dpr = canvasDensity(vp.width, vp.height, window.devicePixelRatio || 1);
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 倍率が続けて変わると前の描画が走ったままになるので、同じ canvas への二重描画を避けて前の描画を止める
      task = p.render({ canvas, canvasContext: ctx, viewport: vp });
      try {
        await task.promise;
      } catch {
        // 取り消し（または描けなかった）
      }
      if (!cancelled) onPainted?.(n);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, scale, rotation, near]);

  return <canvas ref={ref} role="img" aria-label={`PDF の ${n} ページ目`} />;
}
