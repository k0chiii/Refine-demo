import { useSyncExternalStore } from "react";

/**
 * 紙面に印を付けたとき何を作るか（書き込みのモード）。エディタの下の浮遊ツールバーで切り替える
 * （利用者指示 2026-10-17「コメント/FB/なにもなしを切り替えたい。PDF中のリンクとか押せたらありがたいからね」。
 * FB はコメントへ統合したので、今は コメント / 選択 の 2 つ。docs/UI_M3E.md §95）。
 * - comment: 範囲・ピンでコメントを作る
 * - none: 印を付けない（「選択」・カーソルの絵。利用者指示 2026-10-18「なし」は分かりにくい）。紙面を押す・なぞるはコメントに関係せず、
 *   紙面そのもの（PDF のリンク・文字の選択など）が使える
 * 「このタブのあいだ」覚える（sessionStorage。使えなければこのモジュールの変数）。投稿欄の書きかけ（composeStore）とは別で、
 * 投稿しても戻らない。制作物・版を替えても保つ。
 */
export type MarkMode = "comment" | "none";

export const markModes: readonly MarkMode[] = ["comment", "none"];

export const markModeLabel: Record<MarkMode, string> = {
  comment: "コメント",
  none: "選択",
};

/** ツールバーのボタンのアイコン（いまのモードを示す） */
export const markModeIcon: Record<MarkMode, string> = {
  comment: "add_comment",
  none: "arrow_selector_tool",
};

const KEY = "mf100.markMode";
let current: MarkMode = (() => {
  try {
    const v = sessionStorage.getItem(KEY);
    return markModes.includes(v as MarkMode) ? (v as MarkMode) : "comment";
  } catch {
    return "comment";
  }
})();
const listeners = new Set<() => void>();

export function getMarkMode(): MarkMode {
  return current;
}

export function setMarkMode(mode: MarkMode): void {
  if (mode === current) return;
  current = mode;
  try {
    sessionStorage.setItem(KEY, mode);
  } catch {
    /* 覚えられなくても、この画面では効く */
  }
  for (const l of listeners) l();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** 選んである書き込みのモード（権限で使えないものは、使う側で置き換える。effectiveMarkMode） */
export function useMarkMode(): [MarkMode, (m: MarkMode) => void] {
  return [useSyncExternalStore(subscribe, getMarkMode, getMarkMode), setMarkMode];
}

/** 権限を踏まえた、いま実際に効くモード。コメントできない版（受付終了・校了など）では印を付けない */
export function effectiveMarkMode(mode: MarkMode, allowed: { comment: boolean }): MarkMode {
  return mode === "comment" && allowed.comment ? "comment" : "none";
}
