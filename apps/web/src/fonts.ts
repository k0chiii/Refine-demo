/**
 * フォントはセルフホスト（委員会ネットワークや Google Fonts 到達性に依存しない）。
 * M3E の m3e-icon は font-family "Material Symbols Outlined" を期待するため、fontsource の可変フォントをその名前で登録する。
 */
// 可変フォント（wght 100–900）。静的な 400/500/700 の 3 本より通信が少なく、450・600 も正しく出る
// （静的のときは 600 が 700 で描かれ、太く見えていた。docs/UI_M3E.md §43）
import "@fontsource-variable/noto-sans-jp";
// 全アイコン入りの可変フォント（約 4MB）ではなく、使うアイコンだけに絞ったもの（約 36KB）。
// アイコンを増やしたら `pnpm --filter @mf100/web icons` で作り直す（scripts/subset-icons.py）
import symbolsUrl from "./assets/material-symbols-subset.woff2?url";

const style = document.createElement("style");
style.textContent = `
@font-face {
  font-family: "Material Symbols Outlined";
  font-style: normal;
  font-display: block;
  font-weight: 400 600;
  src: url(${symbolsUrl}) format("woff2-variations");
}`;
document.head.appendChild(style);
// アイコン文字（リガチャ）が描画されるまでフォント取得が遅延しないよう明示的に読み込む
void document.fonts.load('400 24px "Material Symbols Outlined"');
