/**
 * 画面下のセーフエリア（iPhone のホームインジケーターの帯など）の高さ（px）。
 * CSS の env(safe-area-inset-bottom) は属性値（m3e-bottom-sheet の detents など）には書けないので、測って数値にする
 */
export function safeAreaBottom(): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom, 0px);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.round(h);
}
