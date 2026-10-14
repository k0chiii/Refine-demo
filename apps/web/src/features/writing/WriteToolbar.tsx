import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Fragment, type ReactNode } from "react";
import {
  M3eButton,
  M3eButtonGroup,
  M3eDivider,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItem,
  M3eMenuItemRadio,
  M3eMenuTrigger,
  M3eToolbar,
  M3eTooltip,
} from "@/ui/m3e";
import { highlightColors, paragraphStyles, textColors, type ParagraphStyleId } from "./extensions";

/** ツールバーの幅に応じて、末尾側のまとまりからその他メニューへ畳む（M3 Toolbars › Adaptive: 入らない操作は末尾のオーバーフローメニューへ） */
export type ToolbarTier = "full" | "mid" | "narrow";

export interface ToolbarActions {
  openLink: () => void;
  openFind: (replace: boolean) => void;
  openCount: () => void;
  openShortcuts: () => void;
  print: () => void;
  download: (kind: "html" | "txt") => void;
}

export function useFormatState(editor: Editor | null) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const style: ParagraphStyleId = e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : "p";
      const align = (["center", "right", "justify"] as const).find((a) =>
        e.isActive({ textAlign: a }),
      );
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        superscript: e.isActive("superscript"),
        subscript: e.isActive("subscript"),
        link: e.isActive("link"),
        quote: e.isActive("blockquote"),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        task: e.isActive("taskList"),
        table: e.isActive("table"),
        style,
        align: align ?? "left",
        color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
        highlight: (e.getAttributes("highlight").color as string | undefined) ?? null,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        canSink: e.can().sinkListItem("listItem") || e.can().sinkListItem("taskItem"),
        canLift: e.can().liftListItem("listItem") || e.can().liftListItem("taskItem"),
        editable: e.isEditable,
      };
    },
  });
}
export type FormatState = NonNullable<ReturnType<typeof useFormatState>>;

const alignOptions = [
  { id: "left", label: "左揃え", icon: "format_align_left", shortcut: "Ctrl+Shift+L" },
  { id: "center", label: "中央揃え", icon: "format_align_center", shortcut: "Ctrl+Shift+E" },
  { id: "right", label: "右揃え", icon: "format_align_right", shortcut: "Ctrl+Shift+R" },
  { id: "justify", label: "両端揃え", icon: "format_align_justify", shortcut: "Ctrl+Shift+J" },
] as const;

/** 書式のコマンド。ツールバー・メニュー・compact のシートが同じものを使う */
export function formatCommands(editor: Editor) {
  const c = () => editor.chain().focus();
  return {
    undo: () => c().undo().run(),
    redo: () => c().redo().run(),
    style: (id: ParagraphStyleId) =>
      id === "p"
        ? c().setParagraph().run()
        : c()
            .setHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 })
            .run(),
    bold: () => c().toggleBold().run(),
    italic: () => c().toggleItalic().run(),
    underline: () => c().toggleUnderline().run(),
    strike: () => c().toggleStrike().run(),
    superscript: () => c().toggleSuperscript().run(),
    subscript: () => c().toggleSubscript().run(),
    color: (v: string | null) => (v ? c().setColor(v).run() : c().unsetColor().run()),
    highlight: (v: string | null) =>
      v ? c().setHighlight({ color: v }).run() : c().unsetHighlight().run(),
    align: (a: "left" | "center" | "right" | "justify") => c().setTextAlign(a).run(),
    bullet: () => c().toggleBulletList().run(),
    ordered: () => c().toggleOrderedList().run(),
    task: () => c().toggleTaskList().run(),
    quote: () => c().toggleBlockquote().run(),
    sink: () =>
      editor.can().sinkListItem("taskItem")
        ? c().sinkListItem("taskItem").run()
        : c().sinkListItem("listItem").run(),
    lift: () =>
      editor.can().liftListItem("taskItem")
        ? c().liftListItem("taskItem").run()
        : c().liftListItem("listItem").run(),
    table: () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    rule: () => c().setHorizontalRule().run(),
    clear: () => c().unsetAllMarks().clearNodes().run(),
    addRowBefore: () => c().addRowBefore().run(),
    addRowAfter: () => c().addRowAfter().run(),
    addColumnBefore: () => c().addColumnBefore().run(),
    addColumnAfter: () => c().addColumnAfter().run(),
    deleteRow: () => c().deleteRow().run(),
    deleteColumn: () => c().deleteColumn().run(),
    deleteTable: () => c().deleteTable().run(),
  };
}

/** アイコンボタン＋プレーンツールチップ（M3 Icon buttons: ホバーで操作名を出す。ショートカットも添える） */
function TB({
  id,
  label,
  shortcut,
  icon,
  on,
  toggle,
  disabled,
  onClick,
  children,
}: {
  id: string;
  label: string;
  shortcut?: string;
  icon: string;
  on?: boolean;
  toggle?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      <M3eIconButton
        id={id}
        aria-label={shortcut ? `${label}（${shortcut}）` : label}
        {...(toggle ? { toggle: true, selected: on === true } : {})}
        {...(disabled ? { disabled: true } : {})}
        {...(onClick ? { onClick } : {})}
        // 押してもエディタの選択範囲を失わない
        onMouseDown={(e: { preventDefault: () => void }) => e.preventDefault()}
      >
        <M3eIcon name={icon} className={on ? "icon--on" : ""} />
        {children}
      </M3eIconButton>
      <M3eTooltip htmlFor={id}>{shortcut ? `${label}（${shortcut}）` : label}</M3eTooltip>
    </>
  );
}

const Sep = () => <span className="wtb__sep" aria-hidden="true" />;

function Swatch({ color, none }: { color: string | null; none?: string }) {
  return color ? (
    <span slot="icon" className="swatch" style={{ background: color }} aria-hidden="true" />
  ) : (
    <M3eIcon slot="icon" name={none ?? "format_color_reset"} />
  );
}

/**
 * 文章エディタのツールバー（Google ドキュメントの上部ツールバーに相当）。
 * M3: 浮遊ツールバー（standard・rounded）。トグルは連結ボタングループ、選択肢はメニュー、入らない操作は末尾のその他メニュー。
 */
export function WriteToolbar({
  editor,
  state: s,
  tier,
  actions,
}: {
  editor: Editor;
  state: FormatState;
  tier: ToolbarTier;
  actions: ToolbarActions;
}) {
  const cmd = formatCommands(editor);
  const styleLabel = paragraphStyles.find((p) => p.id === s.style)?.label ?? "標準テキスト";
  const alignNow = alignOptions.find((a) => a.id === s.align) ?? alignOptions[0];
  const showColor = tier === "full";
  const showLists = tier !== "narrow";
  const showIndent = tier === "full";
  const showAlign = tier !== "narrow";

  return (
    <>
      <M3eToolbar className="wtb" shape="rounded" aria-label="書式">
        <TB
          id="wt-undo"
          label="元に戻す"
          shortcut="Ctrl+Z"
          icon="undo"
          disabled={!s.canUndo}
          onClick={cmd.undo}
        />
        <TB
          id="wt-redo"
          label="やり直す"
          shortcut="Ctrl+Shift+Z"
          icon="redo"
          disabled={!s.canRedo}
          onClick={cmd.redo}
        />
        <Sep />
        <M3eButton
          id="wt-style"
          variant="text"
          className="wtb__style"
          aria-label={`段落スタイル: ${styleLabel}`}
          onMouseDown={(e: { preventDefault: () => void }) => e.preventDefault()}
        >
          {styleLabel}
          <M3eIcon slot="trailing-icon" name="arrow_drop_down" />
          <M3eMenuTrigger htmlFor="wt-style-menu" />
        </M3eButton>
        <M3eTooltip htmlFor="wt-style">段落スタイル</M3eTooltip>
        <Sep />
        <M3eButtonGroup variant="connected" multi className="wtb__group" aria-label="文字の書式">
          <TB
            id="wt-bold"
            label="太字"
            shortcut="Ctrl+B"
            icon="format_bold"
            toggle
            on={s.bold}
            onClick={cmd.bold}
          />
          <TB
            id="wt-italic"
            label="斜体"
            shortcut="Ctrl+I"
            icon="format_italic"
            toggle
            on={s.italic}
            onClick={cmd.italic}
          />
          <TB
            id="wt-underline"
            label="下線"
            shortcut="Ctrl+U"
            icon="format_underlined"
            toggle
            on={s.underline}
            onClick={cmd.underline}
          />
        </M3eButtonGroup>
        {showColor ? (
          <>
            <TB id="wt-color" label="文字の色" icon="format_color_text">
              <M3eMenuTrigger htmlFor="wt-color-menu" />
            </TB>
            <TB id="wt-highlight" label="ハイライトの色" icon="ink_highlighter">
              <M3eMenuTrigger htmlFor="wt-highlight-menu" />
            </TB>
          </>
        ) : null}
        <Sep />
        <TB
          id="wt-link"
          label="リンクを挿入"
          shortcut="Ctrl+K"
          icon="link"
          toggle
          on={s.link}
          onClick={actions.openLink}
        />
        {showAlign ? (
          <>
            <Sep />
            <TB id="wt-align" label={`配置: ${alignNow.label}`} icon={alignNow.icon}>
              <M3eMenuTrigger htmlFor="wt-align-menu" />
            </TB>
          </>
        ) : null}
        {showLists ? (
          <M3eButtonGroup variant="connected" multi className="wtb__group" aria-label="リスト">
            <TB
              id="wt-task"
              label="チェックリスト"
              shortcut="Ctrl+Shift+9"
              icon="checklist"
              toggle
              on={s.task}
              onClick={cmd.task}
            />
            <TB
              id="wt-bullet"
              label="箇条書き"
              shortcut="Ctrl+Shift+8"
              icon="format_list_bulleted"
              toggle
              on={s.bullet}
              onClick={cmd.bullet}
            />
            <TB
              id="wt-ordered"
              label="番号付きリスト"
              shortcut="Ctrl+Shift+7"
              icon="format_list_numbered"
              toggle
              on={s.ordered}
              onClick={cmd.ordered}
            />
          </M3eButtonGroup>
        ) : null}
        {showIndent ? (
          <>
            <TB
              id="wt-outdent"
              label="インデント減"
              shortcut="Ctrl+["
              icon="format_indent_decrease"
              disabled={!s.canLift}
              onClick={cmd.lift}
            />
            <TB
              id="wt-indent"
              label="インデント増"
              shortcut="Ctrl+]"
              icon="format_indent_increase"
              disabled={!s.canSink}
              onClick={cmd.sink}
            />
          </>
        ) : null}
        <Sep />
        <TB id="wt-more" label="その他" icon="more_vert">
          <M3eMenuTrigger htmlFor="wt-more-menu" />
        </TB>
      </M3eToolbar>

      {/* メニューはツールバーの外に置く（ツールバーの contain の影響を受けない） */}
      <M3eMenu id="wt-style-menu" className="wtb-menu">
        {paragraphStyles.map((p) => (
          <M3eMenuItemRadio key={p.id} checked={s.style === p.id} onClick={() => cmd.style(p.id)}>
            <span className={`wtb-menu__style wtb-menu__style--${p.id}`}>{p.label}</span>
            <span slot="trailing-text" className="wtb-menu__kbd">
              {p.shortcut}
            </span>
          </M3eMenuItemRadio>
        ))}
      </M3eMenu>
      <ColorMenu
        id="wt-color-menu"
        colors={textColors}
        current={s.color}
        onPick={cmd.color}
        none="format_color_reset"
      />
      <ColorMenu
        id="wt-highlight-menu"
        colors={highlightColors}
        current={s.highlight}
        onPick={cmd.highlight}
        none="block"
      />
      <M3eMenu id="wt-align-menu" className="wtb-menu">
        {alignOptions.map((a) => (
          <M3eMenuItemRadio key={a.id} checked={s.align === a.id} onClick={() => cmd.align(a.id)}>
            <M3eIcon slot="icon" name={a.icon} />
            {a.label}
            <span slot="trailing-text" className="wtb-menu__kbd">
              {a.shortcut}
            </span>
          </M3eMenuItemRadio>
        ))}
      </M3eMenu>
      <M3eMenu id="wt-more-menu" className="wtb-menu">
        <MoreItem
          icon="format_strikethrough"
          label="取り消し線"
          kbd="Alt+Shift+5"
          on={s.strike}
          onClick={cmd.strike}
        />
        <MoreItem
          icon="superscript"
          label="上付き文字"
          kbd="Ctrl+."
          on={s.superscript}
          onClick={cmd.superscript}
        />
        <MoreItem
          icon="subscript"
          label="下付き文字"
          kbd="Ctrl+,"
          on={s.subscript}
          onClick={cmd.subscript}
        />
        <MoreItem icon="format_quote" label="引用" on={s.quote} onClick={cmd.quote} />
        {!showColor ? (
          <>
            <M3eMenuItem>
              <M3eIcon slot="icon" name="format_color_text" />
              文字の色
              <M3eMenuTrigger htmlFor="wt-color-menu" />
            </M3eMenuItem>
            <M3eMenuItem>
              <M3eIcon slot="icon" name="ink_highlighter" />
              ハイライトの色
              <M3eMenuTrigger htmlFor="wt-highlight-menu" />
            </M3eMenuItem>
          </>
        ) : null}
        {!showAlign ? (
          <M3eMenuItem>
            <M3eIcon slot="icon" name={alignNow.icon} />
            配置
            <M3eMenuTrigger htmlFor="wt-align-menu" />
          </M3eMenuItem>
        ) : null}
        {!showLists ? (
          <>
            <MoreItem
              icon="checklist"
              label="チェックリスト"
              kbd="Ctrl+Shift+9"
              on={s.task}
              onClick={cmd.task}
            />
            <MoreItem
              icon="format_list_bulleted"
              label="箇条書き"
              kbd="Ctrl+Shift+8"
              on={s.bullet}
              onClick={cmd.bullet}
            />
            <MoreItem
              icon="format_list_numbered"
              label="番号付きリスト"
              kbd="Ctrl+Shift+7"
              on={s.ordered}
              onClick={cmd.ordered}
            />
          </>
        ) : null}
        {!showIndent ? (
          <>
            <MoreItem
              icon="format_indent_decrease"
              label="インデント減"
              kbd="Ctrl+["
              disabled={!s.canLift}
              onClick={cmd.lift}
            />
            <MoreItem
              icon="format_indent_increase"
              label="インデント増"
              kbd="Ctrl+]"
              disabled={!s.canSink}
              onClick={cmd.sink}
            />
          </>
        ) : null}
        <M3eDivider />
        <MoreItem icon="table" label="表を挿入" onClick={cmd.table} />
        <M3eMenuItem>
          <M3eIcon slot="icon" name="table_edit" />
          表の編集
          <M3eMenuTrigger htmlFor="wt-table-menu" />
        </M3eMenuItem>
        <MoreItem icon="horizontal_rule" label="区切り線を挿入" onClick={cmd.rule} />
        <MoreItem icon="format_clear" label="書式をクリア" kbd="Ctrl+\" onClick={cmd.clear} />
        <M3eDivider />
        <MoreItem
          icon="find_replace"
          label="検索と置換"
          kbd="Ctrl+H"
          onClick={() => actions.openFind(true)}
        />
        <MoreItem
          icon="match_word"
          label="文字カウント"
          kbd="Ctrl+Shift+C"
          onClick={actions.openCount}
        />
        <MoreItem
          icon="keyboard"
          label="キーボード ショートカット"
          kbd="Ctrl+/"
          onClick={actions.openShortcuts}
        />
        <M3eDivider />
        <MoreItem icon="print" label="印刷" kbd="Ctrl+P" onClick={actions.print} />
        <MoreItem
          icon="download"
          label="HTML でダウンロード"
          onClick={() => actions.download("html")}
        />
        <MoreItem
          icon="text_snippet"
          label="テキストでダウンロード"
          onClick={() => actions.download("txt")}
        />
      </M3eMenu>
      {/* 表の中にいないときは消さずに無効にする（M3 Menus: 条件付きの項目は disabled で残す） */}
      <M3eMenu id="wt-table-menu" className="wtb-menu">
        {(
          [
            ["行を上に挿入", "table_rows", cmd.addRowBefore],
            ["行を下に挿入", "table_rows", cmd.addRowAfter],
            ["列を左に挿入", "view_column", cmd.addColumnBefore],
            ["列を右に挿入", "view_column", cmd.addColumnAfter],
            ["行を削除", "delete", cmd.deleteRow],
            ["列を削除", "delete", cmd.deleteColumn],
            ["表を削除", "delete_forever", cmd.deleteTable],
          ] as Array<[string, string, () => boolean]>
        ).map(([label, icon, run], i) => (
          <Fragment key={label}>
            {i === 4 ? <M3eDivider /> : null}
            <M3eMenuItem disabled={!s.table} onClick={run}>
              <M3eIcon slot="icon" name={icon} />
              {label}
            </M3eMenuItem>
          </Fragment>
        ))}
      </M3eMenu>
    </>
  );
}

function MoreItem({
  icon,
  label,
  kbd,
  on,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  kbd?: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => unknown;
}) {
  return (
    <M3eMenuItem {...(disabled ? { disabled: true } : {})} onClick={() => void onClick()}>
      <M3eIcon slot="icon" name={on ? "check" : icon} />
      {label}
      {kbd ? (
        <span slot="trailing-text" className="wtb-menu__kbd">
          {kbd}
        </span>
      ) : null}
    </M3eMenuItem>
  );
}

function ColorMenu({
  id,
  colors,
  current,
  onPick,
  none,
}: {
  id: string;
  colors: Array<{ label: string; value: string | null }>;
  current: string | null;
  onPick: (v: string | null) => unknown;
  none: string;
}) {
  return (
    <M3eMenu id={id} className="wtb-menu">
      {colors.map((c) => (
        <M3eMenuItemRadio
          key={c.label}
          checked={(current ?? null) === c.value}
          onClick={() => void onPick(c.value)}
        >
          <Swatch color={c.value} none={none} />
          {c.label}
        </M3eMenuItemRadio>
      ))}
    </M3eMenu>
  );
}
