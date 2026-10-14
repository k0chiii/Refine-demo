import { useEffect, useRef } from "react";

export const PINCH_MIN = 0.25;
export const PINCH_MAX = 5;

/** 2 本の指の間隔の比から倍率を出す（上下限つき） */
export function pinchScale(start: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return start;
  const next = start * (distance / startDistance);
  return Math.min(PINCH_MAX, Math.max(PINCH_MIN, +next.toFixed(3)));
}

/**
 * ビューアの中だけのピンチ拡大縮小（アプリ全体は拡大しない。styles.css の touch-action と main.tsx）。
 * 2 本指が載ったら倍率を変え、指の中点の下にある内容が動かないようスクロールを合わせる。
 * スクロール位置の調整は、指の下にある .viewer__stage（各ビューアのスクロール領域）に対して行う。
 */
export function usePinchZoom(
  ref: React.RefObject<HTMLElement | null>,
  scale: number,
  setScale: (s: number) => void,
) {
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { d: number; scale: number } | null = null;
    let stage: HTMLElement | null = null;
    const dist = () => {
      const [a, b] = [...pts.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const mid = () => {
      const [a, b] = [...pts.values()];
      return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        start = { d: dist(), scale: scaleRef.current };
        stage = (e.target as Element | null)?.closest<HTMLElement>(".viewer__stage") ?? null;
      }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!start || pts.size !== 2) return;
      const prev = scaleRef.current;
      const next = pinchScale(start.scale, start.d, dist());
      if (Math.abs(next - prev) < 0.005) return;
      setScale(next);
      scaleRef.current = next;
      // 指の中点の下の内容がずれないように、スクロールを倍率の変化に合わせる（描き直しの後で）
      const s = stage;
      if (s) {
        const r = s.getBoundingClientRect();
        const m = mid();
        const mx = m.x - r.left;
        const my = m.y - r.top;
        const k = next / prev;
        const left = (s.scrollLeft + mx) * k - mx;
        const top = (s.scrollTop + my) * k - my;
        requestAnimationFrame(() => s.scrollTo({ left, top }));
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) start = null;
    };
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", up, true);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move, true);
      el.removeEventListener("pointerup", up, true);
      el.removeEventListener("pointercancel", up, true);
    };
  }, [ref, setScale]);
}
