/**
 * Material 3 Expressive（@m3e/react）の採用コンポーネントを 1 箇所に集約する。
 * - PoC で実在と API を確認済み（v2.9.2）。不足するもの（データテーブル・フォーム入力）は tokens.css のトークンで補完する。
 * - Lit ベースの Web Components なので、slot 名（icon / trailing-icon / header / actions など）は文字列属性で指定する。
 */
export { M3eButton } from "@m3e/react/button";
export { M3eIconButton } from "@m3e/react/icon-button";
export { M3eIcon } from "@m3e/react/icon";
export { M3eTheme } from "@m3e/react/theme";
export { M3eAppBar } from "@m3e/react/app-bar";
export { M3eNavRail } from "@m3e/react/nav-rail";
export { M3eNavItem } from "@m3e/react/nav-bar";
export { M3eCard } from "@m3e/react/card";
export { M3eDialog } from "@m3e/react/dialog";
export { M3eFilterChip, M3eFilterChipSet, M3eAssistChip, M3eChipSet } from "@m3e/react/chips";
export { M3eList, M3eListItem } from "@m3e/react/list";
export { M3eTabs, M3eTab, M3eTabPanel } from "@m3e/react/tabs";
export { M3eBadge } from "@m3e/react/badge";
export { M3eTooltip } from "@m3e/react/tooltip";
export {
  M3eLinearProgressIndicator,
  M3eCircularProgressIndicator,
} from "@m3e/react/progress-indicator";
export { M3eDivider } from "@m3e/react/divider";
export { M3eHeading } from "@m3e/react/heading";
export { M3eSnackbar } from "@m3e/web/snackbar";
