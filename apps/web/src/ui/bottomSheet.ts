/**
 * M3E のボトムシートを「つまんで上下できる」状態にする。
 * - `detents`（止まる高さ）は属性でしか渡せない
 * - ハンドルの領域は `handle` 属性か header スロットがあるときだけ表示される。React の `handle` は
 *   プロパティとして渡るだけで属性にならないため、header の無いシートではハンドルが出ず上下に動かせなかった
 * シートが DOM に入った時点（ref のコールバック）で呼ぶ。
 */
export function prepareBottomSheet(el: HTMLElement, detents = "half full"): void {
  el.setAttribute("handle", "");
  el.setAttribute("detents", detents);
}
