/**
 * 画面がたまにスクロールできなくなる問題の対策（利用者報告 2026-10-15、iPhone）。
 *
 * M3E のダイアログ・モーダルのボトムシートは開くときに `<html>` の `overflow` を保存して `hidden` にし、
 * 閉じるときに保存した値へ戻す。2 つが重なって（シートを閉じながらダイアログを開く等）閉じる順が入れ替わると、
 * 後から閉じた方が「hidden」を書き戻し、何も開いていないのにスクロールできないままになる。
 *
 * そこで、`<html>` の style と各要素の `open` の変化を見張り、少し待っても開いているモーダルが無いのに
 * `overflow: hidden` が残っていれば外す。自前で止めている画面（SNS の全画面プレビュー）は
 * `data-mf-scroll-lock` を付けている間は触らない。
 */
const OPEN_MODALS = "m3e-dialog[open], m3e-bottom-sheet[modal][open]";

export function installScrollLockGuard(doc: Document = document): () => void {
  const html = doc.documentElement;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    timer = null;
    if (html.style.overflow !== "hidden") return;
    if (html.hasAttribute("data-mf-scroll-lock")) return;
    if (doc.querySelector(OPEN_MODALS)) return;
    html.style.overflow = "";
    html.style.scrollbarGutter = "";
  };
  // 開閉のアニメーション（M3 の long ≒ 500ms）が終わるのを待ってから確かめる
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(check, 700);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(html, { attributes: true, attributeFilter: ["style", "data-mf-scroll-lock"] });
  observer.observe(doc.body, { attributes: true, attributeFilter: ["open"], subtree: true });
  return () => {
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
}
