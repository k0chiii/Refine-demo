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

/**
 * PDF.js が日本語の PDF を描くときに読む文字コード表（CMap。小さい静的ファイル）を先に取っておく。
 * 取りに行くのは最初のページを描く瞬間で、そこで待たされていた（計測では PDF の到着後に 2 回、別々に要求されていた）。
 * Service Worker が /pdfjs/ を版をまたいで残す（キャッシュ優先）ので、一度取れば以後は端末から。取るのは同じ 1 回に揃える
 */
const WARM_CMAPS = ["Adobe-Japan1-UCS2", "UniJIS-UTF16-H", "UniJIS-UCS2-H", "90ms-RKSJ-H"] as const;
let cmapsWarmed = false;
export function warmPdfAssets(): void {
  if (cmapsWarmed || typeof fetch === "undefined") return;
  cmapsWarmed = true;
  for (const name of WARM_CMAPS)
    void fetch(`${import.meta.env.BASE_URL}pdfjs/cmaps/${name}.bcmap`, {
      priority: "low",
    } as RequestInit)
      .then((r) => r.arrayBuffer())
      .catch(() => undefined);
}
