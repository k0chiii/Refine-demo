import { useSyncExternalStore } from "react";

/**
 * 紙面に印を付けたとき何を作るか（書き込みのモード）。エディタの下の浮遊ツールバーで切り替える
 * （利用者指示 2026-10-17「コメント/FB/なにもなしを切り替えたい。PDF中のリンクとか押せたらありがたいからね」）。
 * - comment: 範囲・ピンでコメント（解決する指摘）を作る
 * - feedback: 範囲・ピンで FB（解決しない相談）を作る
 * - none: 印を付けない。紙面を押す・なぞるはコメントに関係せず、紙面そのもの（PDF のリンクなど）が押せる
 * 「このタブのあいだ」覚える（sessionStorage。使えなければこのモジュールの変数）。投稿欄の書きかけ（composeStore）とは別で、
 * 投稿しても戻らない。制作物・版を替えても保つ。
 */
export type MarkMode = "comment" | "feedback" | "none";

export const markModes: readonly MarkMode[] = ["comment", "feedback", "none"];

export const markModeLabel: Record<MarkMode, string> = {
  comment: "コメント",
  feedback: "FB",
  none: "なし",
};

/** ツールバーのボタンのアイコン（いまのモードを示す。FB の引き出しの forum とは別の絵にする） */
export const markModeIcon: Record<MarkMode, string> = {
  comment: "add_comment",
  feedback: "chat_add_on",
  none: "pan_tool",
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

/**
 * 権限を踏まえた、いま実際に効くモード。コメントできない版（受付終了・校了など）では「コメント」を FB に置き換える
 * （FB は解決しない話し合いなので、終わった版でも立てられる）。FB も立てられなければ none。
 */
export function effectiveMarkMode(
  mode: MarkMode,
  allowed: { comment: boolean; feedback: boolean },
): MarkMode {
  if (mode === "none") return "none";
  if (mode === "comment" && allowed.comment) return "comment";
  return allowed.feedback ? "feedback" : "none";
}
