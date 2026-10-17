/**
 * 画面の手前に出す部品（投稿欄・「選んだ文字にコメント」・長押しの輪）を置く先。
 * 通常は body。要素の全画面（Fullscreen API。SNS の全画面のプレビューなど）の間は、その要素の外は描かれないので、
 * 全画面にしている要素の中に置く（body に置くと隠れて見えない）
 */
export function portalHost(): HTMLElement {
  const full = typeof document === "undefined" ? null : document.fullscreenElement;
  return full instanceof HTMLElement ? full : document.body;
}
