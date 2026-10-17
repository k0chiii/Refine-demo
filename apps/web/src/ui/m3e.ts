/**
 * Material 3 Expressive（@m3e/react 2.9.2）の採用コンポーネントの目録。
 * - Lit ベースの Web Components。slot 名（icon / label / hint / header / content / actions など）は文字列属性で指定する。
 * - フォーム入力は M3eFormField の中に native input / textarea（IME・キーボード操作を優先）、
 *   選択は M3eSelect + M3eOption、真偽は M3eCheckbox を使う（ui/Field.tsx が包む）。
 * - テーマ（<m3e-theme>）は index.html の body 直下（src/theme.ts）。
 *
 * **画面のコードはここからではなく、部品ごとに `@m3e/react/<name>` から直接 import する**（docs/UI_M3E.md §60）。
 * Web Components は読み込んだ時点で要素を登録する（副作用）ので、この束ねたファイルを 1 つ import すると
 * 全部品（圧縮前 2.5MB・圧縮後約 270KB）が最初の画面に入り、サインイン画面を開くだけで全部を読み込んでいた。
 * 部品ごとに import すれば、ビルドがその画面で使う部品だけを束ねる。このファイルは目録と移行中のコードのために残す
 * （`M3eDialog` は初めて開くまで描かない `ui/LazyDialog` を使う。`M3eSnackbar` は `@m3e/web/snackbar`）。
 */
export { M3eButton } from "@m3e/react/button";
export { M3eIconButton } from "@m3e/react/icon-button";
export { M3eIcon } from "@m3e/react/icon";
export { M3eAppBar } from "@m3e/react/app-bar";
export { M3eNavRail } from "@m3e/react/nav-rail";
export { M3eNavBar, M3eNavItem } from "@m3e/react/nav-bar";
export { M3eCard } from "@m3e/react/card";
export { M3eDialog } from "./LazyDialog";
export {
  M3eFilterChip,
  M3eFilterChipSet,
  M3eAssistChip,
  M3eChip,
  M3eChipSet,
  M3eInputChip,
  M3eSuggestionChip,
} from "@m3e/react/chips";
export {
  M3eList,
  M3eListItem,
  M3eActionList,
  M3eListAction,
  M3eListOption,
  M3eSelectionList,
  M3eExpandableListItem,
} from "@m3e/react/list";
export { M3eExpansionPanel, M3eAccordion } from "@m3e/react/expansion-panel";
export { M3eTabs, M3eTab, M3eTabPanel } from "@m3e/react/tabs";
export { M3eBadge } from "@m3e/react/badge";
export { M3eTooltip } from "@m3e/react/tooltip";
export { M3ePaginator } from "@m3e/react/paginator";
export {
  M3eLinearProgressIndicator,
  M3eCircularProgressIndicator,
} from "@m3e/react/progress-indicator";
export { M3eDivider } from "@m3e/react/divider";
export { M3eHeading } from "@m3e/react/heading";
export { M3eFormField } from "@m3e/react/form-field";
export { M3eSelect } from "@m3e/react/select";
export { M3eOptGroup, M3eOption } from "@m3e/react/option";
export { M3eAutocomplete } from "@m3e/react/autocomplete";
export { M3eCheckbox } from "@m3e/react/checkbox";
export { M3eSwitch } from "@m3e/react/switch";
export { M3eSlider, M3eSliderThumb } from "@m3e/react/slider";
export { M3eSearchBar } from "@m3e/react/search";
export { M3eTextareaAutosize } from "@m3e/react/textarea-autosize";
export { M3eStepper, M3eStep, M3eStepPanel } from "@m3e/react/stepper";
export { M3eSkeleton } from "@m3e/react/skeleton";
export { M3eDateInput } from "@m3e/react/date-input";
export { M3eDatepicker, M3eDatepickerToggle } from "@m3e/react/datepicker";
export { M3eTimepicker, M3eTimepickerToggle } from "@m3e/react/timepicker";
export {
  M3eMenu,
  M3eMenuItem,
  M3eMenuItemCheckbox,
  M3eMenuItemGroup,
  M3eMenuItemRadio,
  M3eMenuTrigger,
} from "@m3e/react/menu";
export { M3eAvatar } from "@m3e/react/avatar";
export { M3eSnackbar } from "@m3e/web/snackbar";
// 4 回目の見直し（利用者の選択）: 下部フローティングツールバー、分割ボタン、セグメント切替、ボトムシート、FAB
export { M3eToolbar } from "@m3e/react/toolbar";
export { M3eSplitButton } from "@m3e/react/split-button";
export { M3eSegmentedButton, M3eButtonSegment } from "@m3e/react/segmented-button";
export { M3eBottomSheet } from "@m3e/react/bottom-sheet";
export { M3eFab } from "@m3e/react/fab";
export { M3eFabMenu, M3eFabMenuItem, M3eFabMenuTrigger } from "@m3e/react/fab-menu";
export { M3eButtonGroup } from "@m3e/react/button-group";
