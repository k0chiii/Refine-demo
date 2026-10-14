import { useEffect, useRef, useState } from "react";

/** ビューアの舞台（`.viewer__stage`）の内側幅を追う。compact で紙面を幅に合わせるために使う。 */
export function useStageWidth<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return [ref, enabled ? width : 0] as const;
}

/** 舞台の左右余白（compact は 16 ＋ 16） */
export const STAGE_INSET = 32;
