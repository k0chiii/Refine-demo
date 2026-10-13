/**
 * Material 3 Expressive テーマの登録。
 * `<m3e-theme>` は index.html で <body> 直下に置いてある（M3E はその位置のときだけ
 * `--md-sys-color-*` を html に、フォントと背景を body に適用する）。
 * ここでは要素を登録し、設定値を一箇所で管理する。
 */
import "@m3e/web/theme";

export const THEME = {
  /** 動的カラーの種（五月祭の青） */
  color: "#1b5fb4",
  variant: "expressive",
  scheme: "light",
  motion: "expressive",
} as const;

const theme = document.querySelector("m3e-theme");
if (theme) {
  theme.setAttribute("color", THEME.color);
  theme.setAttribute("variant", THEME.variant);
  theme.setAttribute("scheme", THEME.scheme);
  theme.setAttribute("motion", THEME.motion);
  theme.setAttribute("strong-focus", "");
}
