import { useEffect, useState } from "react";

/** 画面下に出ているソフトウェアキーボードの高さとみなす最小値（ブラウザのツールバーの出入りを拾わない） */
const MIN_KEYBOARD = 120;

/**
 * レイアウトの高さと、見えている範囲（visual viewport）の差からキーボードの高さを出す。
 * iOS Safari と Android Chrome（既定の resizes-visual）はキーボードでレイアウトを縮めないため、この差がキーボードになる。
 */
export function keyboardInset(
  layoutHeight: number,
  visualHeight: number,
  visualTop: number,
): number {
  const inset = Math.round(layoutHeight - visualHeight - visualTop);
  return inset >= MIN_KEYBOARD ? inset : 0;
}

/** ソフトウェアキーボードの高さ（px。出ていなければ 0）。enabled が false のあいだは監視しない */
export function useKeyboardInset(enabled = true): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!enabled || !vv) {
      setInset(0);
      return;
    }
    const update = () => setInset(keyboardInset(window.innerHeight, vv.height, vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return inset;
}
