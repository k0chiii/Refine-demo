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

/**
 * 画面を「見えている範囲」（visual viewport）に収める（チャットの画面）。enabled のあいだ、
 * :root に --mf-vvh（見えている高さ）と --mf-vv-top（iOS がずらした量）を入れ、キーボードが出ていれば mf-kb-open を付ける。
 * iOS Safari はキーボードでレイアウトを縮めず、ページごと上へずらして入力欄を見せる（アプリバーや下部ナビまで動く）。
 * 画面をこの範囲に固定すると、キーボードのぶん投稿の欄だけが縮み、返信欄はキーボードのすぐ上に留まる。
 */
export function useVisualViewportBox(enabled: boolean) {
  useEffect(() => {
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!enabled || !vv) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--mf-vvh", `${vv.height}px`);
      root.style.setProperty("--mf-vv-top", `${vv.offsetTop}px`);
      root.classList.toggle(
        "mf-kb-open",
        keyboardInset(window.innerHeight, vv.height, vv.offsetTop) > 0,
      );
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--mf-vvh");
      root.style.removeProperty("--mf-vv-top");
      root.classList.remove("mf-kb-open");
    };
  }, [enabled]);
}
