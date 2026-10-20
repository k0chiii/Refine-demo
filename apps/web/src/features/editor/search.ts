/**
 * エディタの URL 検索パラメータ（引き出し・比較・スレッド）。
 * ルートの validateSearch はコード分割されずに最初の読み込みに入るため、Editor.tsx（PDF.js・文章エディタを含む）
 * から切り離して小さなモジュールに置く。ここから Editor を import しないこと。
 */
export type Drawer = "comments" | "versions" | "info";
const drawers: readonly string[] = ["comments", "versions", "info"];
export type EditorSearch = { tab?: Drawer; compare?: string; thread?: string };
export function validateEditorSearch(s: Record<string, unknown>): EditorSearch {
  return {
    ...(typeof s.tab === "string" && drawers.includes(s.tab) ? { tab: s.tab as Drawer } : {}),
    ...(typeof s.compare === "string" && s.compare ? { compare: s.compare } : {}),
    ...(typeof s.thread === "string" && s.thread ? { thread: s.thread } : {}),
  };
}
