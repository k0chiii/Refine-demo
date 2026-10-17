/**
 * 見込みの先読み（画面のコード・アセット）を、いまの画面の描画と取り合わないように「画面が落ち着いてから」行うための小道具。
 * - `whenIdle`: requestIdleCallback（Safari には無いので setTimeout で代用）。戻り値で取り消せる
 * - `saveData`: 通信量を節約する設定（Data Saver）のときは、押されるか分からないものを先に取りに行かない
 * docs/UI_M3E.md §60
 */
export function whenIdle(fn: () => void, timeout = 3000): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => fn(), { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, Math.min(timeout, 800));
  return () => window.clearTimeout(id);
}

export function saveData(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  return nav.connection?.saveData === true;
}
