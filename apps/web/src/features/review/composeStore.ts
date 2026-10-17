import { useSyncExternalStore } from "react";

/**
 * 紙面の上の投稿欄（ComposePopover）の書きかけ（本文・メンション）。
 * Editor の state に置くと 1 文字打つごとに校正画面全体（紙面・コメントの一覧・ダイアログ）が描き直されるので
 * （4 倍遅い CPU で 1 文字 220ms。docs/UI_M3E.md §60）、Editor の外の小さな保管場所に置き、投稿欄だけが購読する。
 * Editor は投稿するとき・Esc の判定のときに `get()` で読み、投稿・取消で `reset()` する。
 * 範囲を選び直してページが変わっても書きかけは残る（以前の Editor の state と同じ振る舞い）。
 */
export interface ComposeState {
  body: string;
  mentions: readonly string[];
}

const EMPTY: ComposeState = { body: "", mentions: [] };

export interface ComposeStore {
  get: () => ComposeState;
  setBody: (body: string) => void;
  setMentions: (ids: string[]) => void;
  reset: () => void;
  subscribe: (fn: () => void) => () => void;
}

export function createComposeStore(): ComposeStore {
  let state = EMPTY;
  const listeners = new Set<() => void>();
  const set = (next: ComposeState) => {
    if (next.body === state.body && next.mentions === state.mentions) return;
    state = next;
    for (const l of listeners) l();
  };
  return {
    get: () => state,
    setBody: (body) => set({ ...state, body }),
    setMentions: (mentions) => set({ ...state, mentions }),
    reset: () => set(EMPTY),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** 投稿欄の中で書きかけを購読する */
export function useComposeState(store: ComposeStore): ComposeState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
