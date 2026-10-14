import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { M3eButtonGroup, M3eFab, M3eIcon, M3eIconButton, M3eToolbar } from "@/ui/m3e";
import { formatCommands, type FormatState } from "./WriteToolbar";

type Group = "text" | "block" | "insert";

/**
 * compact の書式ツールバー（M3 Expressive の floating toolbar・vibrant）。
 * - キーボードが出ているときはキーボードのすぐ上、出ていないときは画面下に浮かぶ（bottom は呼び出し側が --kb で渡す）
 * - ツールバーの隣に丸い FAB（挿入）を置く（M3 Expressive の「floating toolbar ＋ FAB」）。
 *   FAB や「文字の書式」「段落とリスト」を押すと、その上に同じ系統の操作を並べた 2 本目のツールバーが弾むように伸びて出る。
 *   もう一度押すか、別のボタンを押すと切り替わる（Esc でも閉じる）。FAB の＋は開いているあいだ×に回る
 * - どのボタンも押したときに本文からフォーカスを奪わない（キーボードが閉じない）
 */
export function MobileFormatBar({
  editor,
  state: s,
  keyboard,
  onStyle,
  onColor,
  onHighlight,
  onLink,
  onMore,
}: {
  editor: Editor;
  state: FormatState;
  /** キーボードが出ているか（出ているときだけ「キーボードを閉じる」を出す） */
  keyboard: boolean;
  onStyle: () => void;
  onColor: () => void;
  onHighlight: () => void;
  onLink: () => void;
  onMore: () => void;
}) {
  const [open, setOpen] = useState<Group | null>(null);
  const cmd = formatCommands(editor);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 本文のフォーカス（キーボード）を保つ: 押し下げの既定動作を止める
  const keep = {
    onPointerDown: (e: { preventDefault: () => void }) => e.preventDefault(),
    onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
  const btn = (
    label: string,
    icon: string,
    on: boolean | null,
    run: () => unknown,
    disabled = false,
  ) => (
    <M3eIconButton
      key={label}
      aria-label={label}
      {...(on !== null ? { toggle: true, selected: on } : {})}
      {...(disabled ? { disabled: true } : {})}
      {...keep}
      onClick={() => void run()}
    >
      <M3eIcon name={icon} className={on ? "icon--filled" : ""} />
    </M3eIconButton>
  );
  /**
   * 押すと上に 2 本目のツールバーが伸びるボタン。開閉は toggle の選択状態（aria-pressed）で伝える
   * （m3e-icon-button の host は role を持たないため aria-expanded は付けない）
   */
  const groupBtn = (g: Group, label: string, icon: string) => (
    <M3eIconButton
      aria-label={label}
      toggle
      selected={open === g}
      {...keep}
      onClick={() => setOpen((v) => (v === g ? null : g))}
    >
      <M3eIcon name={icon} />
    </M3eIconButton>
  );

  const panels: Record<Group, { label: string; items: React.ReactNode[] }> = {
    text: {
      label: "文字の書式",
      items: [
        btn("段落スタイル", "text_fields", null, onStyle),
        btn("太字", "format_bold", s.bold, cmd.bold),
        btn("斜体", "format_italic", s.italic, cmd.italic),
        btn("下線", "format_underlined", s.underline, cmd.underline),
        btn("取り消し線", "format_strikethrough", s.strike, cmd.strike),
        btn("文字の色", "format_color_text", null, onColor),
        btn("ハイライトの色", "ink_highlighter", null, onHighlight),
      ],
    },
    block: {
      label: "段落とリスト",
      items: [
        btn("箇条書き", "format_list_bulleted", s.bullet, cmd.bullet),
        btn("番号付きリスト", "format_list_numbered", s.ordered, cmd.ordered),
        btn("チェックリスト", "checklist", s.task, cmd.task),
        btn("インデント減", "format_indent_decrease", null, cmd.lift),
        btn("インデント増", "format_indent_increase", null, cmd.sink),
        btn("中央揃え", "format_align_center", s.align === "center", () =>
          cmd.align(s.align === "center" ? "left" : "center"),
        ),
      ],
    },
    insert: {
      label: "挿入",
      items: [
        btn("リンク", "link", null, onLink),
        btn("表", "table", null, cmd.table),
        btn("区切り線", "horizontal_rule", null, cmd.rule),
        btn("引用", "format_quote", s.quote, cmd.quote),
      ],
    },
  };

  return (
    <div className="mfb">
      {open ? (
        <M3eToolbar
          key={open}
          id="mfb-panel"
          className={`mfb__panel mfb__panel--${open}`}
          shape="rounded"
          elevated
          aria-label={panels[open].label}
        >
          <M3eButtonGroup className="mfb__items">{panels[open].items}</M3eButtonGroup>
        </M3eToolbar>
      ) : null}
      <div className="mfb__row">
        <M3eToolbar
          className="mfb__bar"
          variant="vibrant"
          shape="rounded"
          elevated
          aria-label="書式"
        >
          {btn("元に戻す", "undo", null, cmd.undo, !s.canUndo)}
          {btn("やり直す", "redo", null, cmd.redo, !s.canRedo)}
          {groupBtn("text", "文字の書式", "text_format")}
          {groupBtn("block", "段落とリスト", "format_list_bulleted")}
          {btn("その他", "more_vert", null, onMore)}
          {keyboard
            ? btn("キーボードを閉じる", "keyboard_hide", null, () => {
                setOpen(null);
                editor.commands.blur();
              })
            : null}
        </M3eToolbar>
        <M3eFab
          variant="primary"
          className={`mfb__fab ${open === "insert" ? "mfb__fab--open" : ""}`}
          size="small"
          aria-label={open === "insert" ? "挿入を閉じる" : "挿入"}
          {...keep}
          onClick={() => setOpen((v) => (v === "insert" ? null : "insert"))}
        >
          <M3eIcon name="add" />
        </M3eFab>
      </div>
    </div>
  );
}
