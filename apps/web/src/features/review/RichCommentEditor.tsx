import type { Editor, JSONContent } from "@tiptap/core";
import { Mention } from "@tiptap/extension-mention";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { UserAvatar } from "@/ui/UserAvatar";
import { M3eActionList, M3eListAction } from "@m3e/react/list";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eTooltip } from "@m3e/react/tooltip";
import { safeHref } from "./CommentBody";
import { useMentionDirectory, useMentionSearch, type MentionUser } from "./mentions";
import type { RichCommentFieldProps } from "./RichCommentField";

/*
 * コメントの書式つき入力欄の本体（TipTap）。RichCommentField が遅延読み込みする。
 * - 書き込み中に見える形（WYSIWYG）。Markdown の入力規則（**太字**・- 箇条書き・1. 番号・> 引用・`コード`・``` コードブロック）が効く
 * - 本文は @tiptap/markdown で Markdown にして親へ返す。メンションは「@名前」と書き、選んだ人の ID は別に返す
 * - 見出し・水平線・下線は作らない（コメントには要らない。Markdown に下線は無い）
 * - 本文中の URL は打っている間にリンクにする。リンクは http・https・mailto だけ
 */

/** 「@」の前に置いてよい文字（行頭・空白・かぎ括弧など。メールアドレスの途中の @ は拾わない） */
const MENTION_PREFIXES = [" ", "　", "(", "（", "「"];

interface MentionBridge {
  open: (s: { query: string; command: (item: { id: string; label: string }) => void }) => void;
  close: () => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
}

function commentExtensions(placeholder: string | undefined, bridge: MentionBridge) {
  return [
    StarterKit.configure({
      heading: false,
      horizontalRule: false,
      underline: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && safeHref(url) !== null,
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    Markdown,
    Placeholder.configure({ placeholder: placeholder ?? "" }),
    Mention.extend({
      // Markdown では「@名前」と書く（選んだ人の ID は node の attrs から別に集める）
      renderMarkdown: (node: JSONContent) => `@${node.attrs?.label ?? node.attrs?.id ?? ""}`,
    }).configure({
      HTMLAttributes: { class: "mention" },
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
      renderHTML: ({ node }) => [
        "span",
        { class: "mention", "data-type": "mention" },
        `@${node.attrs.label ?? node.attrs.id}`,
      ],
      suggestion: {
        char: "@",
        allowedPrefixes: MENTION_PREFIXES,
        // 候補は MentionMenu が（Convex のサーバー検索で）探す。ここは空でよい
        items: () => [],
        render: () => ({
          onStart: (p) => bridge.open({ query: p.query, command: p.command }),
          onUpdate: (p) => bridge.open({ query: p.query, command: p.command }),
          onExit: () => bridge.close(),
          onKeyDown: ({ event }) => bridge.onKeyDown(event),
        }),
      },
    }),
  ];
}

/** 本文の中に残っているメンションの ID */
function mentionIds(doc: JSONContent): string[] {
  const ids = new Set<string>();
  const walk = (n: JSONContent) => {
    if (n.type === "mention" && typeof n.attrs?.id === "string") ids.add(n.attrs.id);
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return [...ids];
}

export function RichCommentEditor({
  value,
  onValue,
  onMentions,
  onSubmit,
  onEscape,
  onFocus,
  ariaLabel,
  placeholder,
  id,
  autoFocus,
  toolbar,
  rows = 3,
  className,
  ref,
}: RichCommentFieldProps) {
  const dir = useMentionDirectory();
  // 親の関数は最新のものを呼ぶ（エディタは作り直さない）
  const live = useRef({ onValue, onMentions, onSubmit, onEscape, onFocus });
  live.current = { onValue, onMentions, onSubmit, onEscape, onFocus };
  const lastValue = useRef(value);
  const lastMentions = useRef("");

  // メンションの候補（「@」に続けて打っている間だけ）
  const [mention, setMention] = useState<{
    query: string;
    command: (item: { id: string; label: string }) => void;
  } | null>(null);
  const mentionOpen = useRef(false);
  const menuKey = useRef<(e: KeyboardEvent) => boolean>(() => false);
  const [bridge] = useState<MentionBridge>(() => ({
    open: (s) => {
      mentionOpen.current = true;
      setMention(s);
    },
    close: () => {
      mentionOpen.current = false;
      setMention(null);
    },
    onKeyDown: (e) => menuKey.current(e),
  }));

  const [linkOpen, setLinkOpen] = useState(false);
  const linkOpenRef = useRef(setLinkOpen);
  linkOpenRef.current = setLinkOpen;

  const editor = useEditor({
    extensions: commentExtensions(placeholder, bridge),
    content: value,
    contentType: "markdown",
    // 最初の描画から作る（読み込み済みの本体を出す時点でフォーカスできるように）
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        class: "comment-body rt__content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
        "aria-autocomplete": "list",
        ...(id ? { id } : {}),
      },
      handleKeyDown: (_view, event) => {
        if (event.isComposing) return false;
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          live.current.onSubmit?.();
          return true;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          linkOpenRef.current(true);
          return true;
        }
        if (event.key === "Escape") {
          // 候補を出している間の Esc は候補を閉じるだけ（TipTap が処理する）。どちらも紙面側の Esc には伝えない
          event.stopPropagation();
          if (mentionOpen.current || !live.current.onEscape) return false;
          live.current.onEscape();
          return true;
        }
        return false;
      },
    },
    onFocus: () => live.current.onFocus?.(),
    onUpdate: ({ editor: ed }) => {
      const md = ed.getMarkdown().trim();
      lastValue.current = md;
      live.current.onValue(md);
      const ids = mentionIds(ed.getJSON());
      const key = ids.join(",");
      if (key !== lastMentions.current) {
        lastMentions.current = key;
        live.current.onMentions?.(ids);
      }
    },
  });

  // 親が本文を差し替えたとき（投稿後に空にする・訂正の初期値）は、入力欄の中身も置き換える
  useEffect(() => {
    if (!editor || value === lastValue.current) return;
    lastValue.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
    lastMentions.current = "";
  }, [editor, value]);

  // 開いた直後のフォーカス。メニューの項目から開いたとき（訂正）は、メニューが閉じてフォーカスをボタンへ戻すので、そのあとにもう一度合わせる
  useEffect(() => {
    if (!editor || !autoFocus) return;
    const t = window.setTimeout(() => {
      if (!editor.isDestroyed && !editor.isFocused && !document.activeElement?.closest(".rt"))
        editor.commands.focus("end");
    }, 150);
    return () => window.clearTimeout(t);
  }, [editor, autoFocus]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus("end"),
      blur: () => editor?.commands.blur(),
    }),
    [editor],
  );

  // 候補の選択は Enter / Tab / ↑↓（MentionMenu が登録する）
  const pickMention = useCallback(
    (u: MentionUser) => {
      if (!mention) return;
      dir?.remember(u);
      mention.command({ id: u.id, label: u.name });
    },
    [dir, mention],
  );

  return (
    <div className={`rt ${className ?? ""}`} style={{ "--rt-rows": rows } as CSSProperties}>
      {toolbar && editor ? (
        <RichToolbar editor={editor} linkOpen={linkOpen} onLinkOpen={setLinkOpen} />
      ) : null}
      <EditorContent editor={editor} className="rt__editor" />
      {mention ? (
        <MentionMenu query={mention.query} onPick={pickMention} keyHandler={menuKey} />
      ) : null}
    </div>
  );
}

/** 「@」に続けて打った文字の候補（M3E list。サーバーで検索）。↑↓で選び Enter / Tab で確定 */
function MentionMenu({
  query,
  onPick,
  keyHandler,
}: {
  query: string;
  onPick: (u: MentionUser) => void;
  keyHandler: React.RefObject<(e: KeyboardEvent) => boolean>;
}) {
  const dir = useMentionDirectory();
  const hits = useMentionSearch(dir, query).slice(0, 6);
  const [index, setIndex] = useState(0);
  const active = Math.min(index, Math.max(0, hits.length - 1));
  const ref = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  useEffect(() => setIndex(0), [query]);
  // 下に出す余白が足りなければ上に出す（画面の下に固定した投稿欄・キーボードの上）
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const room = 250;
    setAbove(r.bottom + room > vh && r.top > room);
  }, [hits.length]);
  const state = useRef({ hits, active, onPick });
  state.current = { hits, active, onPick };
  useEffect(() => {
    keyHandler.current = (e) => {
      const { hits: list, active: i, onPick: pick } = state.current;
      if (list.length === 0) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setIndex((cur) => (cur + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length);
        return true;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.isComposing) {
        pick(list[i]!);
        return true;
      }
      return false;
    };
    return () => {
      keyHandler.current = () => false;
    };
  }, [keyHandler]);
  if (hits.length === 0) return null;
  return (
    <div ref={ref} className={`rt__mentions ${above ? "rt__mentions--above" : ""}`}>
      {/* 候補の数を読み上げる（候補の出入りは live region で伝える） */}
      <span className="sr-only" aria-live="polite">
        {`メンションの候補 ${hits.length} 人。上下で選び Enter で確定`}
      </span>
      <M3eActionList className="mention-list" aria-label="メンションする人">
        {hits.map((u, i) => (
          <M3eListAction
            key={u.id}
            className={`mention-list__item ${i === active ? "mention-list__item--active" : ""}`}
            onMouseDown={(e: { preventDefault: () => void }) => e.preventDefault()}
            onClick={() => onPick(u)}
          >
            <span slot="leading">
              <UserAvatar seed={u.email ?? u.id} userId={u.id} size={24} />
            </span>
            {u.name}
          </M3eListAction>
        ))}
      </M3eActionList>
    </div>
  );
}

interface Tool {
  key: string;
  icon: string;
  label: string;
  /** 押したときの操作 */
  run: (editor: Editor) => void;
}

const tools: Tool[] = [
  {
    key: "bold",
    icon: "format_bold",
    label: "太字",
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    key: "italic",
    icon: "format_italic",
    label: "斜体",
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    key: "strike",
    icon: "format_strikethrough",
    label: "取り消し線",
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  { key: "link", icon: "link", label: "リンク", run: () => undefined },
  {
    key: "bulletList",
    icon: "format_list_bulleted",
    label: "箇条書き",
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    key: "orderedList",
    icon: "format_list_numbered",
    label: "番号つきリスト",
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    key: "blockquote",
    icon: "format_quote",
    label: "引用",
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  { key: "code", icon: "code", label: "コード", run: (e) => e.chain().focus().toggleCode().run() },
  {
    key: "codeBlock",
    icon: "data_object",
    label: "コードブロック",
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

function RichToolbar({
  editor,
  linkOpen,
  onLinkOpen,
}: {
  editor: Editor;
  linkOpen: boolean;
  onLinkOpen: (open: boolean) => void;
}) {
  const uid = useId();
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const state: Record<string, boolean> = {};
      for (const t of tools) state[t.key] = e.isActive(t.key);
      return state;
    },
    equalityFn: (a, b) => !!b && tools.every((t) => a[t.key] === b[t.key]),
  });
  if (linkOpen) return <LinkRow editor={editor} onClose={() => onLinkOpen(false)} />;
  return (
    <div
      className="rt__toolbar"
      role="toolbar"
      aria-label="書式"
      // 押してもエディタの選択範囲を失わない
      onMouseDown={(e) => e.preventDefault()}
    >
      {tools.map((t) => {
        const bid = `${uid}-${t.key}`;
        return (
          <span key={t.key} className="rt__tool">
            <M3eIconButton
              id={bid}
              size="extra-small"
              toggle
              selected={on[t.key] === true}
              aria-label={t.label}
              onClick={() => (t.key === "link" ? onLinkOpen(true) : t.run(editor))}
            >
              <M3eIcon name={t.icon} />
            </M3eIconButton>
            <M3eTooltip htmlFor={bid}>{t.label}</M3eTooltip>
          </span>
        );
      })}
    </div>
  );
}

/** リンクの宛先を入れる 1 行（ツールバーの代わりに出す）。Enter で付ける・Esc でやめる */
function LinkRow({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const existing = (editor.getAttributes("link").href as string | undefined) ?? "";
  const [url, setUrl] = useState(existing);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const normalized = (() => {
    const t = url.trim();
    if (!t) return null;
    return safeHref(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
  })();
  const apply = () => {
    if (!normalized) return;
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain
        .insertContent({
          type: "text",
          text: normalized,
          marks: [{ type: "link", attrs: { href: normalized } }],
        })
        .run();
    } else {
      chain.extendMarkRange("link").setLink({ href: normalized }).run();
    }
    onClose();
  };
  const close = () => {
    editor.commands.focus();
    onClose();
  };
  return (
    <div className="rt__toolbar rt__linkrow" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="rt__linkinput"
        type="url"
        inputMode="url"
        aria-label="リンクの宛先"
        placeholder="https://"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      />
      <M3eIconButton
        size="extra-small"
        aria-label="リンクを付ける"
        disabled={!normalized}
        onClick={apply}
      >
        <M3eIcon name="check" />
      </M3eIconButton>
      {editor.isActive("link") ? (
        <M3eIconButton
          size="extra-small"
          aria-label="リンクを外す"
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            onClose();
          }}
        >
          <M3eIcon name="link_off" />
        </M3eIconButton>
      ) : null}
      <M3eIconButton size="extra-small" aria-label="閉じる" onClick={close}>
        <M3eIcon name="close" />
      </M3eIconButton>
    </div>
  );
}
