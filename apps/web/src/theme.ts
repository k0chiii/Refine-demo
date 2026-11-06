/**
 * Material 3 Expressive テーマの登録。
 * `<m3e-theme>` は index.html で <body> 直下に置いてある（M3E はその位置のときだけ
 * `--md-sys-color-*` を html に、フォントと背景を body に適用する）。
 * ここでは要素を登録し、設定値を一箇所で管理する。
 */
import "@m3e/web/theme";

export const THEME = {
  /** 動的カラーの種（Indigo #3F51B5。決定 63B 2026-11-01） */
  color: "#3F51B5",
  /**
   * tonal-spot: M3 Dynamic scheme（M3E `<m3e-theme variant="tonal-spot">`）。
   * 主色・面・secondary を種の周辺に tonal に置く（https://matraic.github.io/m3e/components/theme.html）。
   * 意味を持つ色（成功・注意）は styles.css の固定の補助色を使い、tertiary には頼らない
   */
  variant: "tonal-spot",
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
  // OS の「コントラストを上げる」を使う人には M3 の高コントラスト配色を当てる（M3 Design tokens。§35 I-19。利用者決定 2026-10-15）
  const more = matchMedia("(prefers-contrast: more)");
  const applyContrast = () => theme.setAttribute("contrast", more.matches ? "high" : "standard");
  applyContrast();
  more.addEventListener("change", applyContrast);
}
