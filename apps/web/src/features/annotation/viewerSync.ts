import { alignShift, focalPoint, relAt, type PagePosition } from "@mf100/domain";
import { useLayoutEffect, useRef } from "react";
import { peekZoomFocus, takeZoomFocus } from "@/lib/usePinchZoom";

/** 表示位置: ページ（画像は 1）と、ページ内の縦の割合 rel・横の割合 relX */
export type ViewPosition = PagePosition;

/** 舞台（スクロールする枠）の中の点。幅・高さに対する割合 0..1 */
export interface StagePoint {
  x: number;
  y: number;
}

/** スクロール同期の基準の点: 横は中央、縦は舞台の上から 40% の線 */
export const SYNC_AT: StagePoint = { x: 0.5, y: 0.4 };
/** − ＋・倍率のメニュー・幅に合わせる で拡大縮小するときの焦点（舞台の中央） */
export const ZOOM_AT: StagePoint = { x: 0.5, y: 0.5 };

/** 版比較のスクロール・拡大縮小の同期で親が使う操作（PDF・画像のビューア） */
export interface ViewerController {
  /** 舞台の at の点（既定は SYNC_AT）にある箇所 */
  getPosition: (at?: StagePoint) => ViewPosition | null;
  /** その箇所を舞台の at の点（既定は SYNC_AT）に合わせる。このスクロールは onUserScroll に通知しない */
  scrollToPosition: (pos: ViewPosition, at?: StagePoint) => void;
}

export interface ViewerSyncProps {
  /** 版比較: 親がスクロール位置を読み書きする */
  controller?: { current: ViewerController | null };
  /** 版比較: 利用者がスクロールしたとき（プログラムからのスクロールでは呼ばない）。位置は SYNC_AT の点 */
  onUserScroll?: (pos: ViewPosition) => void;
  /**
   * 版比較: 倍率が変わり、焦点の下の箇所を同じ画面位置に保った後に呼ぶ。
   * at はその焦点（舞台の割合）。gesture はこの舞台でピンチ・Ctrl＋ホイールしたとき（ボタン・幅の変化は false）
   */
  onZoomKept?: (at: StagePoint, gesture: boolean) => void;
}

/** プログラムからのスクロールの後、この時間（ms）は利用者のスクロールとして扱わない（同期のループを防ぐ） */
const PROGRAMMATIC_MS = 120;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 画面座標の点 → 舞台の割合 */
function toStagePoint(stage: HTMLElement, pt: { x: number; y: number }): StagePoint {
  const sr = stage.getBoundingClientRect();
  return {
    x: relAt(sr.left, stage.clientWidth, pt.x),
    y: relAt(sr.top, stage.clientHeight, pt.y),
  };
}

/**
 * 舞台の at の点にある箇所（ページと、ページ内の縦・横の割合）。ページの間の余白にかかるときは上のページ。
 * clamp しないと割合は 0..1 を超えうる（拡大縮小の焦点を正確に保つときに使う）
 */
function locate(
  stage: HTMLElement,
  items: ReadonlyArray<HTMLElement | null>,
  at: StagePoint,
  clamp: boolean,
): ViewPosition | null {
  const sr = stage.getBoundingClientRect();
  const y = focalPoint(sr.top, stage.clientHeight, at.y);
  const x = focalPoint(sr.left, stage.clientWidth, at.x);
  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const next = items[i + 1]?.getBoundingClientRect();
    if (y < r.bottom || !next || y < next.top) {
      const rel = relAt(r.top, r.height, y);
      const relX = relAt(r.left, r.width, x);
      return clamp
        ? { page: i + 1, rel: clamp01(rel), relX: clamp01(relX) }
        : { page: i + 1, rel, relX };
    }
  }
  return null;
}

/** その箇所を舞台の at の点に持ってくる（縦、relX があれば横も） */
function place(
  stage: HTMLElement,
  items: ReadonlyArray<HTMLElement | null>,
  pos: ViewPosition,
  at: StagePoint,
): boolean {
  const el = items[pos.page - 1];
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  stage.scrollTop += alignShift(
    r.top,
    r.height,
    pos.rel,
    focalPoint(sr.top, stage.clientHeight, at.y),
  );
  if (pos.relX !== undefined)
    stage.scrollLeft += alignShift(
      r.left,
      r.width,
      pos.relX,
      focalPoint(sr.left, stage.clientWidth, at.x),
    );
  return true;
}

/**
 * PDF・画像のビューアに共通の「視点」の扱い。
 * - 倍率（描く大きさ）が変わったら、焦点の下にあった箇所を同じ画面位置に保つ。焦点はピンチ・Ctrl＋ホイールなら指（ポインタ）の位置、
 *   それ以外（ボタン・幅の変化）は舞台の中央。描き直す前（render 中、DOM はまだ前の大きさ）に箇所を控え、描き直した直後に合わせる
 * - 版比較のための controller・onUserScroll（縦・横）を用意する。プログラムからのスクロールは通知しない
 *
 * @param scale 実際に描く倍率（幅合わせ × 利用者の倍率）。0 は未描画
 * @param items ページの要素（画像は 1 つ）。上から順
 * @param fallback 焦点を保てなかったとき（初回の描画など）の位置の合わせ方
 */
export function useViewerSync(
  stageRef: { current: HTMLElement | null },
  scale: number,
  items: () => ReadonlyArray<HTMLElement | null>,
  { controller, onUserScroll, onZoomKept }: ViewerSyncProps,
  fallback?: () => void,
) {
  const programmatic = useRef(0);
  const scrollTo = (pos: ViewPosition, at: StagePoint): void => {
    const stage = stageRef.current;
    if (!stage) return;
    programmatic.current = performance.now();
    place(stage, items(), pos, at);
  };
  if (controller)
    controller.current = {
      getPosition: (at = SYNC_AT) => {
        const stage = stageRef.current;
        return stage ? locate(stage, items(), at, true) : null;
      },
      scrollToPosition: (pos, at = SYNC_AT) => scrollTo(pos, at),
    };

  const onScroll = () => {
    const stage = stageRef.current;
    if (!stage || !onUserScroll) return;
    if (performance.now() - programmatic.current <= PROGRAMMATIC_MS) return;
    // 縦の割合は 0..1 に丸めない: 焦点がページの間の余白にあるとき、丸めるとページの端に寄って余白の分ずれる
    const pos = locate(stage, items(), SYNC_AT, false);
    if (pos)
      onUserScroll({
        ...pos,
        ...(pos.relX !== undefined ? { relX: Math.min(1, Math.max(0, pos.relX)) } : {}),
      });
  };

  // 倍率が変わる描画で、描き直す前の焦点の下の箇所を控える（StrictMode の 2 回目の render では控え直さない）
  const committed = useRef(scale);
  const snap = useRef<{
    scale: number;
    pos: ViewPosition | null;
    to: StagePoint;
    gesture: boolean;
  } | null>(null);
  if (scale !== committed.current && snap.current?.scale !== scale) {
    const stage = stageRef.current;
    const focus = stage ? peekZoomFocus(stage) : null;
    const from = stage && focus ? toStagePoint(stage, focus.from) : ZOOM_AT;
    const to = stage && focus ? toStagePoint(stage, focus.to) : from;
    const pos = stage && committed.current > 0 ? locate(stage, items(), from, false) : null;
    snap.current = { scale, pos, to, gesture: focus !== null };
  }
  useLayoutEffect(() => {
    const was = committed.current;
    committed.current = scale;
    const s = snap.current;
    snap.current = null;
    if (was === scale) return;
    const stage = stageRef.current;
    if (!stage || scale <= 0 || !s || s.scale !== scale || !s.pos) {
      fallback?.();
      return;
    }
    // ピンチの焦点はこちらで合わせたので、フックにはスクロールさせない
    if (s.gesture) takeZoomFocus(stage);
    scrollTo(s.pos, s.to);
    onZoomKept?.(s.to, s.gesture);
  }, [scale]);

  return { onScroll };
}
