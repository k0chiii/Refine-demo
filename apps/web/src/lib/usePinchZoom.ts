import { useEffect, useRef } from "react";

export const PINCH_MIN = 0.25;
export const PINCH_MAX = 5;

const clamp = (s: number) => Math.min(PINCH_MAX, Math.max(PINCH_MIN, +s.toFixed(3)));

/** 2 本の指の間隔の比から倍率を出す（上下限つき） */
export function pinchScale(start: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return start;
  return clamp(start * (distance / startDistance));
}

/**
 * 拡大縮小のあと、指（またはポインタ）の下にあった点が同じ画面位置に来るスクロール量の変化。
 * `u` は拡大前の内容の左上から見た点の位置、`k` は倍率の比、`left` は拡大後の内容の左上（画面座標）、`target` は合わせたい画面座標
 */
export function anchorShift(u: number, k: number, left: number, target: number): number {
  return left + u * k - target;
}

type Pt = { x: number; y: number };

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
export function usePinchZoom(el: HTMLElement | null, scale: number, setScale: (s: number) => void) {
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
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
    const commit = (stage: HTMLElement, content: HTMLElement, u: Pt, target: Pt, k: number) => {
      const prev = scaleRef.current;
      const next = clamp(prev * k);
      const kk = next / prev;
      if (Math.abs(kk - 1) < 0.005) return;
      scaleRef.current = next;
      setScale(next);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
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
      g.k = pinchScale(g.s0, g.d0, Math.hypot(a.x - b.x, a.y - b.y)) / g.s0;
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
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      const stage = stageOf(e.target);
      const content = stage?.firstElementChild as HTMLElement | null | undefined;
      if (!stage || !content) return;
      e.preventDefault();
      const r = content.getBoundingClientRect();
      const at = { x: e.clientX, y: e.clientY };
      commit(stage, content, { x: at.x - r.left, y: at.y - r.top }, at, Math.exp(-e.deltaY * 0.01));
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
    };
  }, [el, setScale]);
}
