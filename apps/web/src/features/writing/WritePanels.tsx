import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { Checkbox, Field, TextInput } from "@/ui/Field";
import { M3eActionList, M3eButton, M3eIcon, M3eIconButton, M3eListAction } from "@/ui/m3e";
import { gotoMatch, replaceAll, replaceCurrent, searchState, setSearch } from "./plugins";
import { buildPlainText, offsetToPos } from "./plainText";

/** 文書内の位置へ移る（選択して画面内に入れ、エディタに戻る） */
export function jumpTo(editor: Editor, from: number, to = from) {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)).scrollIntoView(),
  );
  editor.view.focus();
}

/**
 * ドキュメントの概要（Google ドキュメントの左パネル「概要」）。見出しを自動で拾い、押すとその位置へ移る。
 * M3 Lists（1 行のリスト。階層は字下げで示す）。
 */
export function OutlinePanel({ editor }: { editor: Editor }) {
  const headings = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const out: Array<{ pos: number; level: number; text: string; current: boolean }> = [];
      const sel = e.state.selection.from;
      e.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          out.push({
            pos,
            level: node.attrs.level as number,
            text: node.textContent,
            current: false,
          });
          return false;
        }
        return node.type.name !== "paragraph";
      });
      let cur = -1;
      out.forEach((h, i) => {
        if (h.pos <= sel) cur = i;
      });
      if (cur >= 0) out[cur]!.current = true;
      return out;
    },
  });
  if (headings.length === 0)
    return (
      <p className="small muted write-panel__empty">
        見出し（見出し 1〜3）を付けると、ここに表示されます
      </p>
    );
  return (
    <M3eActionList className="list outline" aria-label="ドキュメントの概要">
      {headings.map((h) => (
        <M3eListAction
          key={h.pos}
          className={`list__item outline__item outline__item--${h.level} ${h.current ? "outline__item--current" : ""}`}
          {...(h.current ? { "aria-current": "true" } : {})}
          onClick={() => jumpTo(editor, h.pos + 1)}
        >
          <span className="outline__text">{h.text || "（空の見出し）"}</span>
        </M3eListAction>
      ))}
    </M3eActionList>
  );
}

/** 検索と置換（Ctrl+F / Ctrl+H）。編集を続けられるよう、ダイアログではなく補助ペインに置く */
export function FindPanel({
  editor,
  focusKey,
  readOnly,
}: {
  editor: Editor;
  /** 変わるたびに検索欄へフォーカスする（Ctrl+F を押し直したとき） */
  focusKey: number;
  readOnly: boolean;
}) {
  const [query, setQuery] = useState(() => searchState(editor).query);
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [state, setState] = useState(() => searchState(editor));
  const [done, setDone] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setState(setSearch(editor, query, caseSensitive));
  }, [editor, query, caseSensitive]);
  // 文書が変わったら件数を更新（プラグインが一致を数え直す）
  useEffect(() => {
    const on = () => setState(searchState(editor));
    editor.on("transaction", on);
    return () => {
      editor.off("transaction", on);
    };
  }, [editor]);
  useEffect(() => {
    const el = box.current?.querySelector("input");
    el?.focus();
    el?.select();
  }, [focusKey]);
  // ペインを閉じたら強調を消す
  useEffect(() => () => void setSearch(editor, "", false), [editor]);

  const n = state.results.length;
  return (
    <div className="find" ref={box}>
      <Field label="検索">
        <TextInput
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setDone(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setState(gotoMatch(editor, e.shiftKey ? -1 : 1));
            }
          }}
          placeholder="語句"
        />
      </Field>
      <div className="find__nav">
        <span className="small muted" aria-live="polite">
          {query ? (n ? `${state.current + 1} / ${n} 件` : "見つかりません") : ""}
        </span>
        <span className="spacer" />
        <M3eIconButton
          aria-label="前へ（Shift+Enter）"
          disabled={n === 0}
          onClick={() => setState(gotoMatch(editor, -1))}
        >
          <M3eIcon name="keyboard_arrow_up" />
        </M3eIconButton>
        <M3eIconButton
          aria-label="次へ（Enter）"
          disabled={n === 0}
          onClick={() => setState(gotoMatch(editor, 1))}
        >
          <M3eIcon name="keyboard_arrow_down" />
        </M3eIconButton>
      </div>
      <Checkbox checked={caseSensitive} onChange={setCaseSensitive} label="大文字と小文字を区別" />
      {readOnly ? null : (
        <>
          <Field label="置換後の文字列">
            <TextInput value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          </Field>
          <div className="row find__actions">
            <M3eButton
              variant="outlined"
              disabled={n === 0}
              onClick={() => setState(replaceCurrent(editor, replacement))}
            >
              置換
            </M3eButton>
            <M3eButton
              variant="tonal"
              disabled={n === 0}
              onClick={() => {
                const count = replaceAll(editor, replacement);
                setDone(`${count} 件を置き換えました`);
              }}
            >
              すべて置換
            </M3eButton>
          </div>
          {done ? (
            <p className="small muted" role="status">
              {done}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export interface ReferenceThread {
  id: string;
  index: number;
  body: string;
  authorName: string;
  quote: string | null;
  resolution: string;
}

/**
 * 直近の版に付いたコメント（読むだけ）。押すと引用している文字列を下書きの中から探して選ぶ。
 * 「コメントを見ながら直す」ための補助ペイン（M3 Supporting pane: 主の内容に対してだけ意味を持つ副の内容）。
 */
export function ReferencePanel({
  editor,
  label,
  threads,
}: {
  editor: Editor;
  label: string | null;
  threads: ReferenceThread[] | null;
}) {
  const [missing, setMissing] = useState<string | null>(null);
  if (threads === null)
    return <p className="small muted write-panel__empty">まだ提出した版がありません</p>;
  if (threads.length === 0)
    return <p className="small muted write-panel__empty">{label} に未対応のコメントはありません</p>;
  const find = (t: ReferenceThread) => {
    if (!t.quote) return setMissing(t.id);
    const index = buildPlainText(editor.state.doc);
    const at = index.text.indexOf(t.quote);
    if (at < 0) return setMissing(t.id);
    setMissing(null);
    const size = editor.state.doc.content.size;
    jumpTo(editor, offsetToPos(index, at, size), offsetToPos(index, at + t.quote.length, size));
  };
  return (
    <div className="refs">
      <p className="small muted refs__head">
        {label} の未対応のコメント（押すと本文の該当箇所を選びます）
      </p>
      <M3eActionList className="list" aria-label="直近の版のコメント">
        {threads.map((t) => (
          <M3eListAction key={t.id} className="list__item refs__item" onClick={() => find(t)}>
            <span className="list__headline">
              #{t.index} {t.body}
            </span>
            <span slot="supporting-text">
              {t.authorName}
              {t.quote
                ? `・「${t.quote.length > 24 ? `${t.quote.slice(0, 24)}…` : t.quote}」`
                : "・位置なし"}
              {missing === t.id ? "・本文に見つかりません（直し済みかもしれません）" : ""}
            </span>
          </M3eListAction>
        ))}
      </M3eActionList>
    </div>
  );
}
