/**
 * 日本語入力（IME）の変換中・確定のキーか。変換を確定する Enter を、候補の決定や送信と取り違えないために見る
 * （利用者報告 2026-10-25「iPhone でユーザーをひらがなで検索できない」）。
 * - Chrome・Android: 変換中の keydown は isComposing が true
 * - iPhone・Mac の Safari: 変換を閉じて（compositionend）から確定の keydown を送るので isComposing は false。keyCode の 229 で見分ける
 */
export function isImeKeyEvent(e: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return e.isComposing || e.keyCode === 229;
}
