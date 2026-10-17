import { useEffect, useRef } from "react";

export const PINCH_MIN = 0.25;
export const PINCH_MAX = 5;

/** 倍率の下限・上限。PDF は紙面の大きさで上限が変わる（呼び出し側が limits で渡す） */
export interface ZoomLimits {
  min: number;
  max: number;
}
export const DEFAULT_ZOOM_LIMITS: ZoomLimits = { min: PINCH_MIN, max: PINCH_MAX };
const clampTo = (s: number, l: ZoomLimits) => Math.min(l.max, Math.max(l.min, +s.toFixed(3)));

/** 2 本の指の間隔の比から倍率を出す（上下限つき。段階に丸めず連続で） */
export function pinchScale(
  start: number,
  startDistance: number,
  distance: number,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
): number {
  if (startDistance <= 0) return start;
  return clampTo(start * (distance / startDistance), limits);
}

/** 「＋」「−」の 1 回の倍率（等比。細かく刻む。利用者指示 2026-10-17「PDF がもっと細かく拡大できると良い」） */
export const ZOOM_STEP = 1.15;
/** 「＋」「−」で 1 段動かした倍率（上下限つき） */
export function stepScale(
  scale: number,
  dir: 1 | -1,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
): number {
  return clampTo(dir > 0 ? scale * ZOOM_STEP : scale / ZOOM_STEP, limits);
}

/** Ctrl（Mac のトラックパッドのピンチ）・⌘ ＋ ホイールの 1 目盛りの倍率 */
const WHEEL_RATE = 0.01;
/** ホイールが止まってから倍率を確定して描き直すまで（ms） */
const WHEEL_COMMIT_MS = 160;

/**
 * 拡大縮小のあと、指（またはポインタ）の下にあった点が同じ画面位置に来るスクロール量の変化。
 * `u` は拡大前の内容の左上から見た点の位置、`k` は倍率の比、`left` は拡大後の内容の左上（画面座標）、`target` は合わせたい画面座標
 */
export function anchorShift(u: number, k: number, left: number, target: number): number {
  return left + u * k - target;
}

type Pt = { x: number; y: number };

/**
 * ピンチ・Ctrl＋ホイールの焦点（画面座標）。from は拡大前に指（ポインタ）の下にあった点、to はそれを置きたい点。
 * 倍率を確定する直前に舞台ごとに置き、焦点を自分で保てるビューア（PDF・画像）が描き直しのときに受け取る。
 * 受け取られなければ、このフックが従来どおりスクロールを合わせる（文章のビューア）
 */
export interface ZoomFocus {
  from: Pt;
  to: Pt;
}
const zoomFocus = new WeakMap<HTMLElement, ZoomFocus>();
/** この舞台に置かれた焦点を見る（取り除かない） */
export function peekZoomFocus(stage: HTMLElement): ZoomFocus | null {
  return zoomFocus.get(stage) ?? null;
}
/** この舞台に置かれた焦点を受け取る（以後このフックはスクロールを合わせない） */
export function takeZoomFocus(stage: HTMLElement): ZoomFocus | null {
  const f = zoomFocus.get(stage) ?? null;
  zoomFocus.delete(stage);
  return f;
}

/**
 * 校正物（ビューアの中）だけのピンチ拡大縮小。アプリ全体は拡大しない（styles.css の touch-action と main.tsx）。
 *
 * - タッチイベントで受ける（passive: false）。2 本指になったら既定の動作（スクロール・ページの拡大）を止めるので、
 *   ブラウザにジェスチャーを取られない。Pointer Events だとスクロールが始まった時点で pointercancel になり、
 *   指を広げても何も起きなかった（利用者指摘 2026-10-15）
 * - 指を動かしている間は内容を CSS の transform で拡大して見せるだけにし（PDF の描き直しをしないので滑らか）、
 *   指を離したときに倍率を確定して描き直す。指の中点の下にあった箇所が同じ位置に来るようスクロールを合わせる
 * - 対象の要素は state で受ける（以前は ref を最初の描画時だけ見ていたため、読み込み後に描かれるビューアに付かず、
 *   ピンチが一度も効いていなかった）
 * - トラックパッドのピンチ（Ctrl＋ホイール）でも同じように拡大縮小する
 */
export function usePinchZoom(
  el: HTMLElement | null,
  scale: number,
  setScale: (s: number) => void,
  /** 倍率の上下限（PDF は紙面の大きさで変わる）。既定は PINCH_MIN〜PINCH_MAX */
  limits?: () => ZoomLimits,
) {
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const limitsRef = useRef(limits);
  limitsRef.current = limits;
  useEffect(() => {
    if (!el) return;
    let g: {
      d0: number;
      s0: number;
      k: number;
      stage: HTMLElement;
      content: HTMLElement;
      /** 開始時の中点（画面座標）と、内容の左上から見たその位置 */
      m0: Pt;
      u: Pt;
      m: Pt;
    } | null = null;

    const two = (e: TouchEvent): [Pt, Pt] | null => {
      const a = e.touches[0];
      const b = e.touches[1];
      return a && b
        ? [
            { x: a.clientX, y: a.clientY },
            { x: b.clientX, y: b.clientY },
          ]
        : null;
    };
    const stageOf = (target: EventTarget | null) =>
      (target as Element | null)?.closest<HTMLElement>(".viewer__stage") ??
      el.querySelector<HTMLElement>(".viewer__stage");

    /** 倍率を確定し、描き直しの後で中点の下の箇所を元の画面位置に戻す */
    const bounds = () => limitsRef.current?.() ?? DEFAULT_ZOOM_LIMITS;
    const commit = (stage: HTMLElement, content: HTMLElement, u: Pt, target: Pt, k: number) => {
      const prev = scaleRef.current;
      const next = clampTo(prev * k, bounds());
      const kk = next / prev;
      if (Math.abs(kk - 1) < 0.005) return;
      scaleRef.current = next;
      const r0 = content.getBoundingClientRect();
      const focus: ZoomFocus = { from: { x: r0.left + u.x, y: r0.top + u.y }, to: target };
      zoomFocus.set(stage, focus);
      setScale(next);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          // ビューアが焦点を受け取って自分で合わせた
          if (zoomFocus.get(stage) !== focus) return;
          zoomFocus.delete(stage);
          const r = content.getBoundingClientRect();
          stage.scrollBy({
            left: anchorShift(u.x, kk, r.left, target.x),
            top: anchorShift(u.y, kk, r.top, target.y),
          });
        }),
      );
    };

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        if (e.touches.length > 2 && g) e.preventDefault();
        return;
      }
      const pts = two(e);
      const stage = stageOf(e.target);
      const content = stage?.firstElementChild as HTMLElement | null | undefined;
      if (!pts || !stage || !content) return;
      e.preventDefault();
      const [a, b] = pts;
      const m0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = content.getBoundingClientRect();
      const u = { x: m0.x - r.left, y: m0.y - r.top };
      content.style.transformOrigin = `${u.x}px ${u.y}px`;
      content.style.willChange = "transform";
      g = {
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        s0: scaleRef.current,
        k: 1,
        stage,
        content,
        m0,
        u,
        m: m0,
      };
    };
    const move = (e: TouchEvent) => {
      if (!g) return;
      const pts = two(e);
      if (!pts) return;
      if (e.cancelable) e.preventDefault();
      const [a, b] = pts;
      g.k = pinchScale(g.s0, g.d0, Math.hypot(a.x - b.x, a.y - b.y), bounds()) / g.s0;
      g.m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dx = g.m.x - g.m0.x;
      const dy = g.m.y - g.m0.y;
      g.content.style.transform = `translate(${dx}px, ${dy}px) scale(${g.k})`;
    };
    const end = (e: TouchEvent) => {
      if (!g || e.touches.length >= 2) return;
      const { stage, content, u, m, k } = g;
      g = null;
      content.style.transform = "";
      content.style.transformOrigin = "";
      content.style.willChange = "";
      commit(stage, content, u, m, k);
    };
    // Ctrl／⌘ ＋ ホイール: ホイールが回っているあいだは内容を CSS の transform で拡大して見せるだけにし（描き直さない）、
    // 止まって WHEEL_COMMIT_MS 後に 1 回だけ倍率を確定して描き直す（ピンチと同じ）。段階に丸めず、回した量だけ連続で変わる
    let w: {
      s0: number;
      k: number;
      stage: HTMLElement;
      content: HTMLElement;
      /** 回し始めた点（画面座標）と、内容の左上から見たその位置。回している間は動かさない */
      at: Pt;
      u: Pt;
      timer: number;
    } | null = null;
    const endWheel = () => {
      if (!w) return;
      const { stage, content, u, at, k } = w;
      window.clearTimeout(w.timer);
      w = null;
      content.style.transform = "";
      content.style.transformOrigin = "";
      content.style.willChange = "";
      commit(stage, content, u, at, k);
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const stage = stageOf(e.target);
      const content = stage?.firstElementChild as HTMLElement | null | undefined;
      if (!stage || !content) return;
      e.preventDefault();
      if (!w) {
        const r = content.getBoundingClientRect();
        const at = { x: e.clientX, y: e.clientY };
        const u = { x: at.x - r.left, y: at.y - r.top };
        content.style.transformOrigin = `${u.x}px ${u.y}px`;
        content.style.willChange = "transform";
        w = { s0: scaleRef.current, k: 1, stage, content, at, u, timer: 0 };
      }
      const bw = bounds();
      // deltaMode が行（Firefox のマウスホイール）のときは 1 行を約 16px として換算する
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const next = clampTo(w.s0 * w.k * Math.exp(-dy * WHEEL_RATE), bw);
      w.k = next / w.s0;
      w.content.style.transform = `scale(${w.k})`;
      window.clearTimeout(w.timer);
      w.timer = window.setTimeout(endWheel, WHEEL_COMMIT_MS);
    };

    const opts = { passive: false, capture: true } as const;
    el.addEventListener("touchstart", start, opts);
    el.addEventListener("touchmove", move, opts);
    el.addEventListener("touchend", end, opts);
    el.addEventListener("touchcancel", end, opts);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start, opts);
      el.removeEventListener("touchmove", move, opts);
      el.removeEventListener("touchend", end, opts);
      el.removeEventListener("touchcancel", end, opts);
      el.removeEventListener("wheel", wheel);
      if (w) {
        window.clearTimeout(w.timer);
        w.content.style.transform = "";
        w.content.style.transformOrigin = "";
        w.content.style.willChange = "";
        w = null;
      }
    };
  }, [el, setScale]);
}
