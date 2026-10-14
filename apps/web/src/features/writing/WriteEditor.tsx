import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { countText } from "@mf100/domain";
import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PaneHandle } from "@/features/editor/PaneHandle";
import { SubmitDialog } from "@/features/upload/SubmitDialog";
import { describeError } from "@/lib/errors";
import { formatJstShort } from "@/lib/format";
import { useMedia, useWindowClass } from "@/lib/useMedia";
import { ActionSheet, type ActionSheetItem } from "@/ui/ActionSheet";
import { AppBarSlot } from "@/ui/AppBarSlot";
import {
  M3eBottomSheet,
  M3eButton,
  M3eDialog,
  M3eIcon,
  M3eIconButton,
  M3eToolbar,
  M3eTooltip,
} from "@/ui/m3e";
import { documentExtensions, highlightColors, paragraphStyles, textColors } from "./extensions";
import { buildPlainText, documentHtml } from "./plainText";
import { NotationMarks, SearchReplace } from "./plugins";
import { NotationPanel, useNotationCheck } from "@/features/notation/NotationPanel";
import { LinkDialog, ShortcutsDialog, WordCountDialog } from "./WriteDialogs";
import { FindPanel, OutlinePanel, ReferencePanel, type ReferenceThread } from "./WritePanels";
import {
  formatCommands,
  useFormatState,
  WriteToolbar,
  type FormatState,
  type ToolbarActions,
  type ToolbarTier,
} from "./WriteToolbar";

type Panel = "outline" | "find" | "notation" | "refs";
const panels: Array<{ id: Panel; label: string; icon: string }> = [
  { id: "outline", label: "概要", icon: "toc" },
  { id: "find", label: "検索と置換", icon: "find_replace" },
  { id: "notation", label: "表記", icon: "spellcheck" },
  { id: "refs", label: "指摘", icon: "rate_review" },
];
const LIVE_COUNT_KEY = "mf100.write.liveCount";

/**
 * 文章エディタ（`/works/:id/write`）。Google ドキュメントの「書く」体験を M3 Expressive の部品で組む。
 * - 骨格は M3 の supporting pane: 主＝紙面、副＝概要／検索と置換／指摘（expanded 以上は固定 360 / 412、839 以下はボトムシート）
 * - 書式は上端の浮遊ツールバー（compact は下端のドッキングツールバー＋その他はボトムシート）
 * - 下書きは数秒ごとに自動保存（版番号で競合を検出）。「版として提出」で HTML の版スナップショットを作り、校正に回す
 */
export function WriteEditor({ workId }: { workId: string }) {
  const workData = useQuery(api.works.get, { workId });
  const docData = useQuery(api.documents.get, { workId });
  const [reloadKey, setReloadKey] = useState(0);
  if (workData === undefined || docData === undefined)
    return <p className="muted write-loading">読み込み中…</p>;
  return (
    <WriteSurface
      key={`${reloadKey}`}
      workId={workId}
      workTitle={workData.work.title}
      canSubmit={workData.can.submit && workData.work.lifecycle === "active"}
      acceptingRevisionId={
        workData.acceptingRevisionId ??
        [...workData.revisions].sort((a, b) => b.submittedAt - a.submittedAt)[0]?.id ??
        null
      }
      doc={docData}
      onReload={() => setReloadKey((k) => k + 1)}
    />
  );
}

type DocData = NonNullable<ReturnType<typeof useQuery<typeof api.documents.get>>>;
type SaveStatus =
  | { kind: "saved"; at: number | null }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "conflict" };

const emptyDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

function WriteSurface({
  workId,
  workTitle,
  canSubmit,
  acceptingRevisionId,
  doc,
  onReload,
}: {
  workId: string;
  workTitle: string;
  canSubmit: boolean;
  acceptingRevisionId: string | null;
  doc: DocData;
  onReload: () => void;
}) {
  const navigate = useNavigate();
  const save = useMutation(api.documents.save);
  const cls = useWindowClass();
  const compact = cls === "compact";
  const mobile = useMedia("(max-width: 839px)");
  const defaultPane = useMedia("(min-width: 1200px)") ? 412 : 360;
  const canEdit = doc.canEdit;

  // 開いたときの内容（以後の同期は自動保存と「最新を読み込む」で行う）
  const initial = useMemo<JSONContent>(() => {
    if (!doc.draft) return emptyDoc;
    try {
      return JSON.parse(doc.draft.content) as JSONContent;
    } catch {
      return emptyDoc;
    }
  }, []);
  const baseVersion = useRef(doc.draft?.version ?? 0);
  const dirty = useRef(false);
  const saving = useRef(false);
  const conflict = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<SaveStatus>({
    kind: "saved",
    at: doc.draft?.updatedAt ?? null,
  });

  const [panel, setPanel] = useState<Panel | null>(mobile ? null : "outline");
  const [lastPanel, setLastPanel] = useState<Panel>("outline");
  const [paneW, setPaneW] = useState<number | null>(null);
  const [findFocus, setFindFocus] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInit, setLinkInit] = useState({ text: "", url: "", hasSelection: false });
  const [countOpen, setCountOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [submitFiles, setSubmitFiles] = useState<File[] | null>(null);
  const [sheet, setSheet] = useState<{ title: string; items: ActionSheetItem[] } | null>(null);
  const [liveCount, setLiveCount] = useState(() => {
    try {
      return localStorage.getItem(LIVE_COUNT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [mainW, setMainW] = useState(0);
  const [bodyW, setBodyW] = useState(0);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!bodyEl) return;
    const ro = new ResizeObserver(() => {
      setBodyW(bodyEl.clientWidth);
      setMainW(mainRef.current?.clientWidth ?? 0);
    });
    ro.observe(bodyEl);
    if (mainRef.current) ro.observe(mainRef.current);
    return () => ro.disconnect();
  }, [bodyEl]);
  useEffect(() => {
    if (panel === null) setPaneW(null);
    else setLastPanel(panel);
  }, [panel]);

  // キーボード ショートカットは React の状態を参照するので、ref 経由で最新の処理を呼ぶ
  const handlers = useRef<Record<string, () => boolean>>({});
  const shortcuts = useMemo(
    () =>
      Extension.create({
        name: "mf100WriteShortcuts",
        addKeyboardShortcuts() {
          const call = (k: string) => () => handlers.current[k]?.() ?? false;
          return {
            "Mod-k": call("link"),
            "Mod-f": call("find"),
            "Mod-h": call("replace"),
            "Mod-/": call("shortcuts"),
            "Mod-Shift-c": call("count"),
            "Mod-\\": call("clear"),
            "Alt-Shift-5": call("strike"),
            "Mod-]": call("sink"),
            "Mod-[": call("lift"),
            "Mod-s": call("save"),
            "Mod-p": call("print"),
          };
        },
      }),
    [],
  );

  const editor = useEditor({
    extensions: [
      ...documentExtensions({
        placeholder: canEdit ? "ここに入力するか、# で見出し、- で箇条書き" : "",
        editable: canEdit,
      }),
      SearchReplace,
      NotationMarks,
      shortcuts,
    ],
    content: initial,
    editable: canEdit,
    editorProps: {
      attributes: {
        class: "doc",
        "aria-label": "本文",
        "aria-multiline": "true",
        role: "textbox",
        spellcheck: "true",
        lang: "ja",
      },
    },
    onUpdate: () => {
      if (!canEdit) return;
      dirty.current = true;
      if (!conflict.current) setStatus({ kind: "dirty" });
      schedule();
    },
  });

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!editor || saving.current || !dirty.current || conflict.current || !canEdit) return;
    saving.current = true;
    dirty.current = false;
    setStatus({ kind: "saving" });
    try {
      const r = await save({
        workId: workId as Id<"works">,
        title: workTitle,
        content: JSON.stringify(editor.getJSON()),
        text: buildPlainText(editor.state.doc).text,
        baseVersion: baseVersion.current,
      });
      baseVersion.current = r.version;
      setStatus(dirty.current ? { kind: "dirty" } : { kind: "saved", at: r.updatedAt });
    } catch (e) {
      dirty.current = true;
      const err = describeError(e);
      if (err.code === "version_conflict") {
        conflict.current = true;
        setStatus({ kind: "conflict" });
      } else setStatus({ kind: "error", message: err.message });
    } finally {
      saving.current = false;
      if (dirty.current && !conflict.current) schedule();
    }
  }, [editor, save, workId, workTitle, canEdit]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  function schedule() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flushRef.current(), 1200);
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // 保存していない変更があるまま離れようとしたら止める
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, []);

  // 他の人が保存した（こちらに未保存の変更が無い）ときは、黙って最新に入れ替える
  useEffect(() => {
    const v = doc.draft?.version ?? 0;
    if (v > baseVersion.current && !dirty.current && !saving.current) onReload();
  }, [doc.draft?.version]);

  const fmt = useFormatState(editor);

  const openPanel = (p: Panel) => {
    if (mobile) {
      setPanel(p);
      requestAnimationFrame(() =>
        (sheetRef.current as { show?: (d?: number) => void } | null)?.show?.(1),
      );
    } else setPanel((cur) => (cur === p ? null : p));
  };
  const openFind = (replace: boolean) => {
    void replace;
    setPanel("find");
    if (mobile)
      requestAnimationFrame(() =>
        (sheetRef.current as { show?: (d?: number) => void } | null)?.show?.(1),
      );
    setFindFocus((n) => n + 1);
  };
  const openLink = () => {
    if (!editor || !canEdit) return;
    const { from, to, empty } = editor.state.selection;
    const url = (editor.getAttributes("link").href as string | undefined) ?? "";
    setLinkInit({
      text: editor.state.doc.textBetween(from, to, " "),
      url,
      hasSelection: !empty || url !== "",
    });
    setLinkOpen(true);
  };
  const applyLink = (text: string, url: string) => {
    setLinkOpen(false);
    if (!editor) return;
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!url) {
      chain.unsetLink().run();
      return;
    }
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    if (linkInit.hasSelection) chain.setLink({ href }).run();
    else
      chain
        .insertContent({
          type: "text",
          text: text || href,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
  };
  const download = (kind: "html" | "txt") => {
    if (!editor) return;
    const body =
      kind === "html"
        ? documentHtml(workTitle, editor.getHTML())
        : buildPlainText(editor.state.doc).text;
    const blob = new Blob([body], { type: kind === "html" ? "text/html" : "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${workTitle}.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const actions: ToolbarActions = {
    openLink,
    openFind,
    openCount: () => setCountOpen(true),
    openShortcuts: () => setShortcutsOpen(true),
    print: () => window.print(),
    download,
  };
  const startSubmit = async () => {
    if (!editor) return;
    dirty.current = dirty.current || false;
    await flush();
    const html = documentHtml(workTitle, editor.getHTML());
    setSubmitFiles([new File([html], `${workTitle}.html`, { type: "text/html" })]);
  };

  if (editor) {
    const cmd = formatCommands(editor);
    handlers.current = {
      link: () => (openLink(), true),
      find: () => (openFind(false), true),
      replace: () => (openFind(true), true),
      shortcuts: () => (setShortcutsOpen(true), true),
      count: () => (setCountOpen(true), true),
      clear: () => (canEdit ? cmd.clear() : false),
      strike: () => (canEdit ? cmd.strike() : false),
      sink: () => (canEdit ? cmd.sink() : false),
      lift: () => (canEdit ? cmd.lift() : false),
      save: () => (void flush(), true),
      print: () => (window.print(), true),
    };
  }

  // 直近の版の指摘（読むだけ）
  const refRevision = useQuery(
    api.revisions.get,
    acceptingRevisionId ? { revisionId: acceptingRevisionId as Id<"revisions"> } : "skip",
  );
  const refThreads: ReferenceThread[] | null = acceptingRevisionId
    ? (refRevision?.threads ?? [])
        .map((t, i) => ({
          id: t.id,
          index: i + 1,
          body: t.body,
          authorName: t.author?.name ?? "",
          quote: t.anchor && t.anchor.type === "text_range" ? t.anchor.quote : null,
          resolution: t.resolution,
        }))
        .filter(
          (t) =>
            t.resolution === "open" ||
            t.resolution === "acknowledged" ||
            t.resolution === "deferred",
        )
    : null;

  const plain = editor ? buildPlainText(editor.state.doc).text : "";
  const counts = liveCount ? countText(plain) : null;
  const tier: ToolbarTier = mainW >= 920 ? "full" : mainW >= 700 ? "mid" : "narrow";
  const desktopPanel = !mobile && panel !== null;

  const statusText =
    status.kind === "saving"
      ? "保存しています…"
      : status.kind === "dirty"
        ? "未保存の変更"
        : status.kind === "error"
          ? "保存できませんでした"
          : status.kind === "conflict"
            ? "他の人の変更があります"
            : status.at
              ? `下書きを保存しました・${formatJstShort(status.at)}`
              : "まだ保存していません";

  const notation = useNotationCheck(editor, workId);
  const panelBody = (p: Panel | null) =>
    !editor ? null : p === "outline" ? (
      <OutlinePanel editor={editor} />
    ) : p === "find" ? (
      <FindPanel editor={editor} focusKey={findFocus} readOnly={!canEdit} />
    ) : p === "notation" ? (
      <NotationPanel editor={editor} check={notation} readOnly={!canEdit} />
    ) : p === "refs" ? (
      <ReferencePanel
        editor={editor}
        label={refRevision?.revision.label ?? null}
        threads={refThreads}
      />
    ) : null;
  const panelTabs = (current: Panel | null, onPick: (p: Panel) => void) => (
    <div className="drawer__tabs" role="tablist" aria-label="補助ペイン">
      {panels.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          aria-selected={current === p.id}
          className={`drawer__tab ${current === p.id ? "drawer__tab--on" : ""}`}
          onClick={() => onPick(p.id)}
        >
          {p.label}
          {p.id === "refs" && refThreads && refThreads.length > 0 ? (
            <span className="drawer__n">{refThreads.length}</span>
          ) : null}
          {p.id === "notation" && notation.findings.length > 0 ? (
            <span className="drawer__n">{notation.findings.length}</span>
          ) : null}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`write ${compact ? "write--compact" : ""}`}>
      <AppBarSlot slot="leading">
        <M3eIconButton
          aria-label="制作物へ戻る"
          onClick={() => void navigate({ to: "/works/$workId", params: { workId } })}
        >
          <M3eIcon name="arrow_back" className="icon--mirror" />
        </M3eIconButton>
      </AppBarSlot>
      <AppBarSlot slot="title">{workTitle}</AppBarSlot>
      <AppBarSlot slot="subtitle">
        <span className={`write__status write__status--${status.kind}`} role="status">
          {canEdit ? statusText : "閲覧のみ（書けるのは版を提出できる人です）"}
        </span>
      </AppBarSlot>
      <AppBarSlot slot="actions">
        {canEdit && canSubmit ? (
          compact ? (
            <M3eIconButton
              variant="tonal"
              aria-label="版として提出"
              onClick={() => void startSubmit()}
            >
              <M3eIcon name="upload_file" />
            </M3eIconButton>
          ) : (
            <M3eButton variant="filled" onClick={() => void startSubmit()}>
              <M3eIcon slot="icon" name="upload_file" />
              版として提出
            </M3eButton>
          )
        ) : null}
      </AppBarSlot>

      <div
        ref={setBodyEl}
        className={`write__body ${desktopPanel ? "write__body--panel" : mobile ? "" : "write__body--handle"}`}
        style={
          desktopPanel && paneW !== null
            ? ({ "--ws-pane": `${paneW}px` } as CSSProperties)
            : undefined
        }
      >
        <div className="write__main" ref={mainRef}>
          {editor && fmt && canEdit && !compact ? (
            <div className="write__toolbar">
              <WriteToolbar editor={editor} state={fmt} tier={tier} actions={actions} />
            </div>
          ) : null}
          <div className="write__canvas">
            <div className="write__page">
              <EditorContent editor={editor} />
            </div>
          </div>
          {counts ? (
            <button type="button" className="write__count" onClick={() => setCountOpen(true)}>
              {counts.characters.toLocaleString("ja-JP")} 文字
            </button>
          ) : null}
          {!mobile ? (
            <M3eToolbar
              vertical
              className="ws__side-toolbar write__side"
              shape="rounded"
              elevated
              aria-label="補助ペイン"
            >
              {panels.map((p) => (
                <span key={p.id} className="write__side-item">
                  <M3eIconButton
                    id={`ws-${p.id}`}
                    aria-label={p.label}
                    toggle
                    selected={panel === p.id}
                    onClick={() => openPanel(p.id)}
                  >
                    <M3eIcon name={p.icon} className={panel === p.id ? "icon--filled" : ""} />
                  </M3eIconButton>
                  <M3eTooltip htmlFor={`ws-${p.id}`} position="before">
                    {p.label}
                  </M3eTooltip>
                </span>
              ))}
            </M3eToolbar>
          ) : null}
          {editor && fmt && canEdit && compact ? (
            <CompactToolbar
              editor={editor}
              state={fmt}
              onMore={() => setSheet(moreSheet(editor, fmt, actions, openPanel, setSheet))}
              onStyle={() => setSheet(styleSheet(editor, fmt))}
            />
          ) : null}
        </div>
        {!mobile ? (
          <div className="ws__spacer">
            <PaneHandle
              width={paneW ?? defaultPane}
              defaultWidth={defaultPane}
              maxWidth={Math.max(240, bodyW - 24 - 360)}
              collapsed={!desktopPanel}
              onResize={setPaneW}
              onToggle={() => (desktopPanel ? setPanel(null) : setPanel(lastPanel))}
            />
          </div>
        ) : null}
        {desktopPanel ? (
          <aside className="drawer" aria-label="補助ペイン">
            {panelTabs(panel, (p) => setPanel(p))}
            <div className="drawer__body">{panelBody(panel)}</div>
          </aside>
        ) : null}
      </div>
      {mobile ? (
        <M3eBottomSheet
          ref={sheetRef as never}
          modal
          hideable
          handle
          handleLabel="補助ペイン"
          className="write__sheet"
          onClosed={() => setPanel(null)}
        >
          <div className="drawer drawer--sheet">
            {panelTabs(panel ?? "outline", (p) => setPanel(p))}
            <div className="drawer__body">{panelBody(panel ?? "outline")}</div>
          </div>
        </M3eBottomSheet>
      ) : null}

      <ActionSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        {...(sheet?.title ? { title: sheet.title } : {})}
        items={sheet?.items ?? []}
      />
      <LinkDialog
        open={linkOpen}
        initialText={linkInit.text}
        initialUrl={linkInit.url}
        hasSelection={linkInit.hasSelection}
        onApply={applyLink}
        onClose={() => setLinkOpen(false)}
      />
      <WordCountDialog
        open={countOpen}
        text={plain}
        selection={
          editor && !editor.state.selection.empty
            ? editor.state.doc.textBetween(
                editor.state.selection.from,
                editor.state.selection.to,
                "\n",
              )
            : ""
        }
        live={liveCount}
        onLive={(on) => {
          setLiveCount(on);
          try {
            localStorage.setItem(LIVE_COUNT_KEY, on ? "1" : "0");
          } catch {}
        }}
        onClose={() => setCountOpen(false)}
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <M3eDialog open={status.kind === "conflict"} closeLabel="閉じる" onClosed={() => undefined}>
        <span slot="header">他の人が先に保存しました</span>
        <div className="dialog-body">
          <p style={{ margin: 0 }}>
            {doc.draft?.updatedBy?.name ?? "別の人"} さんが{" "}
            {doc.draft ? formatJstShort(doc.draft.updatedAt) : ""} に保存した内容があります。
            同時に書くことはまだできません（共同編集は今後の機能です）。
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            最新を読み込むと、この画面でまだ保存していない変更は消えます。残したい文章は先にコピーしてください。
          </p>
        </div>
        <div slot="actions" className="row">
          <M3eButton
            variant="text"
            onClick={() => setStatus({ kind: "error", message: "他の人の変更があります" })}
          >
            あとで
          </M3eButton>
          <M3eButton variant="filled" onClick={onReload}>
            最新を読み込む
          </M3eButton>
        </div>
      </M3eDialog>
      {status.kind === "error" ? (
        <div className="write__error" role="alert">
          <span>{status.message}</span>
          {conflict.current ? (
            <M3eButton variant="text" onClick={onReload}>
              最新を読み込む
            </M3eButton>
          ) : (
            <M3eButton variant="text" onClick={() => void flush()}>
              再試行
            </M3eButton>
          )}
        </div>
      ) : null}
      <SubmitDialog
        workId={workId}
        open={submitFiles !== null}
        onClose={() => setSubmitFiles(null)}
        {...(submitFiles ? { initialFiles: submitFiles } : {})}
      />
    </div>
  );
}

/** compact: 下端のドッキングツールバー（M3 Toolbars: compact はツールバー 1 本、入らない操作はボトムシート） */
function CompactToolbar({
  editor,
  state: s,
  onMore,
  onStyle,
}: {
  editor: Editor;
  state: FormatState;
  onMore: () => void;
  onStyle: () => void;
}) {
  const cmd = formatCommands(editor);
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const btn = (
    label: string,
    icon: string,
    on: boolean | null,
    run: () => unknown,
    disabled = false,
  ) => (
    <M3eIconButton
      aria-label={label}
      {...(on !== null ? { toggle: true, selected: on } : {})}
      {...(disabled ? { disabled: true } : {})}
      onMouseDown={keep}
      onClick={() => void run()}
    >
      <M3eIcon name={icon} className={on ? "icon--on" : ""} />
    </M3eIconButton>
  );
  return (
    <M3eToolbar className="write__docked" aria-label="書式">
      {btn("元に戻す", "undo", null, cmd.undo, !s.canUndo)}
      {btn("段落スタイル", "text_fields", null, onStyle)}
      {btn("太字", "format_bold", s.bold, cmd.bold)}
      {btn("斜体", "format_italic", s.italic, cmd.italic)}
      {btn("チェックリスト", "checklist", s.task, cmd.task)}
      {btn("箇条書き", "format_list_bulleted", s.bullet, cmd.bullet)}
      {btn("その他", "more_vert", null, onMore)}
    </M3eToolbar>
  );
}

function styleSheet(editor: Editor, s: FormatState) {
  const cmd = formatCommands(editor);
  return {
    title: "段落スタイル",
    items: paragraphStyles.map((p) => ({
      icon: p.id === "p" ? "notes" : "title",
      label: p.label,
      selected: s.style === p.id,
      onSelect: () => void cmd.style(p.id),
    })),
  };
}

function moreSheet(
  editor: Editor,
  s: FormatState,
  actions: ToolbarActions,
  openPanel: (p: Panel) => void,
  setSheet: (v: { title: string; items: ActionSheetItem[] } | null) => void,
) {
  const cmd = formatCommands(editor);
  const colorSheet =
    (
      title: string,
      list: typeof textColors,
      run: (v: string | null) => unknown,
      current: string | null,
    ) =>
    () =>
      setTimeout(
        () =>
          setSheet({
            title,
            items: list.map((c) => ({
              icon: c.value ? "circle" : "block",
              label: c.label,
              selected: current === c.value,
              onSelect: () => void run(c.value),
            })),
          }),
        0,
      );
  const items: ActionSheetItem[] = [
    { icon: "redo", label: "やり直す", onSelect: () => void cmd.redo() },
    {
      icon: "format_underlined",
      label: "下線",
      selected: s.underline,
      onSelect: () => void cmd.underline(),
    },
    {
      icon: "format_strikethrough",
      label: "取り消し線",
      selected: s.strike,
      onSelect: () => void cmd.strike(),
    },
    {
      icon: "format_color_text",
      label: "文字の色",
      onSelect: colorSheet("文字の色", textColors, cmd.color, s.color),
    },
    {
      icon: "ink_highlighter",
      label: "ハイライトの色",
      onSelect: colorSheet("ハイライトの色", highlightColors, cmd.highlight, s.highlight),
    },
    { icon: "link", label: "リンクを挿入", onSelect: actions.openLink },
    {
      icon: "format_list_numbered",
      label: "番号付きリスト",
      selected: s.ordered,
      onSelect: () => void cmd.ordered(),
    },
    { icon: "format_indent_increase", label: "インデント増", onSelect: () => void cmd.sink() },
    { icon: "format_indent_decrease", label: "インデント減", onSelect: () => void cmd.lift() },
    {
      icon: "format_align_center",
      label: "中央揃え",
      selected: s.align === "center",
      onSelect: () => void cmd.align(s.align === "center" ? "left" : "center"),
    },
    { icon: "format_quote", label: "引用", selected: s.quote, onSelect: () => void cmd.quote() },
    { icon: "table", label: "表を挿入", onSelect: () => void cmd.table() },
    { icon: "horizontal_rule", label: "区切り線を挿入", onSelect: () => void cmd.rule() },
    { icon: "format_clear", label: "書式をクリア", onSelect: () => void cmd.clear() },
    { icon: "toc", label: "概要", onSelect: () => openPanel("outline") },
    { icon: "find_replace", label: "検索と置換", onSelect: () => actions.openFind(true) },
    { icon: "spellcheck", label: "表記", onSelect: () => openPanel("notation") },
    { icon: "rate_review", label: "指摘", onSelect: () => openPanel("refs") },
    { icon: "match_word", label: "文字カウント", onSelect: actions.openCount },
  ];
  return { title: "その他", items };
}
