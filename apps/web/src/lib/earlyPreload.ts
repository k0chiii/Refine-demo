import { saveData, warmPdfAssets } from "./preload";

/**
 * 起動した直後（データが届くより前）に、開こうとしている画面の重い部品を先に読み込み始める。
 * 校正画面（/works/:id）は、制作物 → 版 → 添付の順にデータが届いてから PDF ビューア（PDF.js 本体）を読み込み始めていたので、
 * その分だけ紙面が遅れた。URL が校正画面だと分かる時点で、いちばん多い PDF のビューアと文字コード表を読み始める。
 * - Service Worker が効いている（2 回目以降の訪問）ときだけ。ファイルは端末の中にあるので、先に評価しても通信は増えない。
 *   初回の訪問では、描画に必要な通信と取り合うので行わない
 * - 通信量を節約する設定（Data Saver）のときは行わない
 */
export function preloadForPath(path: string): void {
  if (saveData()) return;
  if (!/^\/works\/[^/]+(\/v\/\d+)?\/?$/.test(path)) return;
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
  void import("@/features/annotation/PdfViewer").catch(() => undefined);
  warmPdfAssets();
}
