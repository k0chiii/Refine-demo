import { useSyncExternalStore } from "react";

/**
 * 「コメントを追加」を押した直後（次のクリック・ドラッグ 1 回だけ印を付ける状態。ツールバーのボタン）。
 * 1 つ置くか Esc で戻る。持続するモードではない（保存もしない）。ビューアは、この間だけクリックもピンにする（カーソルは十字）。
 * 持つのはエディタ（Editor）、読むのは紙面のビューア
 */
let armed = false;
const listeners = new Set<() => void>();

export function setMarkArmed(next: boolean): void {
  if (next === armed) return;
  armed = next;
  for (const l of listeners) l();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const get = () => armed;

export const useMarkArmed = () => useSyncExternalStore(subscribe, get, get);
