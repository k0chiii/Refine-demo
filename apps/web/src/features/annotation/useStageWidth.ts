import { useEffect, useRef, useState } from "react";

/**
 * ビューアの舞台（`.viewer__stage`）の内容幅（左右の padding を除く）を追う。
 * compact と版比較で紙面を幅に合わせるために使う。舞台の余白は compact 16、それ以外 24 なので、計算に固定値を使わない。
 */
export function useStageWidth<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const update = () => {
      const cs = getComputedStyle(el);
      setWidth(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return [ref, enabled ? width : 0] as const;
}
