import { useSyncExternalStore } from "react";

/** スマホで文字を選んだときの扱い。comment: 選ぶとコメントできる（既定）。text: 端末の選択（コピー・調べる）だけで、アプリは何もしない */
export type SelectionMode = "comment" | "text";

/** このタブのセッションのあいだ覚える（制作物を替えても保ち、新しいセッションでは既定に戻る。§106） */
const KEY = "mf100-selection-mode";

function load(): SelectionMode {
  try {
    return sessionStorage.getItem(KEY) === "text" ? "text" : "comment";
  } catch {
    return "comment";
  }
}

let mode: SelectionMode = load();
const listeners = new Set<() => void>();

export function setSelectionMode(next: SelectionMode) {
  if (next === mode) return;
  mode = next;
  try {
    sessionStorage.setItem(KEY, next);
  } catch {
    // 保存できない（プライベートブラウズなど）ときは、このページのあいだだけ覚える
  }
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const get = () => mode;

export function useSelectionMode(): SelectionMode {
  return useSyncExternalStore(subscribe, get, get);
}
