import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { buildPlainText, offsetToPos } from "./plainText";

/* ---------- 検索と置換（Google ドキュメントの Ctrl+F / Ctrl+H） */

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  results: Array<{ from: number; to: number }>;
  current: number;
}
const searchKey = new PluginKey<DecorationSet>("mf100-search");

function findMatches(doc: PMNode, query: string, caseSensitive: boolean) {
  if (!query) return [];
  const index = buildPlainText(doc);
  const hay = caseSensitive ? index.text : index.text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: Array<{ from: number; to: number }> = [];
  let at = hay.indexOf(needle);
  while (at >= 0 && out.length < 2000) {
    out.push({
      from: offsetToPos(index, at, doc.content.size),
      to: offsetToPos(index, at + needle.length, doc.content.size),
    });
    at = hay.indexOf(needle, at + Math.max(1, needle.length));
  }
  return out;
}

export const SearchReplace = Extension.create<object, SearchState>({
  name: "mf100Search",
  addStorage() {
    return { query: "", caseSensitive: false, results: [], current: 0 };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    const decorate = (doc: PMNode) => {
      storage.results = findMatches(doc, storage.query, storage.caseSensitive);
      if (storage.current >= storage.results.length) storage.current = 0;
      return DecorationSet.create(
        doc,
        storage.results.map((r, i) =>
          Decoration.inline(r.from, r.to, {
            class: i === storage.current ? "search-hit search-hit--current" : "search-hit",
          }),
        ),
      );
    };
    return [
      new Plugin({
        key: searchKey,
        state: {
          init: (_, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(searchKey) ? decorate(tr.doc) : old),
        },
        props: { decorations: (state) => searchKey.getState(state) },
      }),
    ];
  },
});

const searchStorage = (editor: Editor) =>
  (editor.storage as unknown as Record<string, SearchState>).mf100Search!;

export function setSearch(editor: Editor, query: string, caseSensitive: boolean) {
  const s = searchStorage(editor);
  s.query = query;
  s.caseSensitive = caseSensitive;
  s.current = 0;
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, true));
  return { ...s };
}

/** 次（dir=1）・前（dir=-1）の一致へ移り、選択して画面内に入れる */
export function gotoMatch(editor: Editor, dir: 1 | -1) {
  const s = searchStorage(editor);
  if (s.results.length === 0) return { ...s };
  s.current = (s.current + dir + s.results.length) % s.results.length;
  const r = s.results[s.current]!;
  editor.view.dispatch(
    editor.state.tr
      .setSelection(TextSelection.create(editor.state.doc, r.from, r.to))
      .setMeta(searchKey, true)
      .scrollIntoView(),
  );
  return { ...s };
}

export function replaceCurrent(editor: Editor, replacement: string) {
  const s = searchStorage(editor);
  const r = s.results[s.current];
  if (!r) return { ...s };
  editor.chain().focus().insertContentAt({ from: r.from, to: r.to }, replacement).run();
  return { ...searchStorage(editor) };
}

export function replaceAll(editor: Editor, replacement: string): number {
  const s = searchStorage(editor);
  const n = s.results.length;
  if (n === 0) return 0;
  const tr = editor.state.tr;
  // 後ろから置き換えると前の位置がずれない
  for (const r of [...s.results].reverse()) {
    if (replacement) tr.insertText(replacement, r.from, r.to);
    else tr.delete(r.from, r.to);
  }
  editor.view.dispatch(tr);
  return n;
}

export const searchState = (editor: Editor): SearchState => ({ ...searchStorage(editor) });

/* ---------- 範囲の強調（校正画面: 指摘の範囲・選択中の下書き範囲） */

export interface HighlightRange {
  from: number;
  to: number;
  className: string;
  attrs?: Record<string, string>;
  /** 範囲の先頭に置く番号（指摘の #n）。文字としては本文に入らない（ウィジェット） */
  badge?: string;
}
const rangeKey = new PluginKey<DecorationSet>("mf100-ranges");

export const RangeHighlight = Extension.create({
  name: "mf100Ranges",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: rangeKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            const next = tr.getMeta(rangeKey) as HighlightRange[] | undefined;
            if (next)
              return DecorationSet.create(
                tr.doc,
                next
                  .filter((r) => r.to > r.from)
                  .flatMap((r) => [
                    Decoration.inline(r.from, r.to, { class: r.className, ...r.attrs }),
                    ...(r.badge
                      ? [
                          Decoration.widget(
                            r.from,
                            () => {
                              const el = document.createElement("span");
                              el.className = "text-anchor__badge";
                              el.textContent = r.badge!;
                              el.setAttribute("aria-hidden", "true");
                              if (r.attrs?.["data-thread"])
                                el.dataset.thread = r.attrs["data-thread"];
                              return el;
                            },
                            { side: -1, key: `badge-${r.attrs?.["data-thread"] ?? r.from}` },
                          ),
                        ]
                      : []),
                  ]),
              );
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations: (state) => rangeKey.getState(state) },
      }),
    ];
  },
});

export function setHighlights(editor: Editor, ranges: HighlightRange[]) {
  editor.view.dispatch(editor.state.tr.setMeta(rangeKey, ranges).setMeta("addToHistory", false));
}

/* ---------- 表記統一の指摘（文章エディタ: 誤表記に波線） */

export interface NotationMark {
  from: number;
  to: number;
  id: string;
  review: boolean;
  title: string;
}
const notationKey = new PluginKey<DecorationSet>("mf100-notation");

export const NotationMarks = Extension.create({
  name: "mf100Notation",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: notationKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            const next = tr.getMeta(notationKey) as NotationMark[] | undefined;
            if (next)
              return DecorationSet.create(
                tr.doc,
                next
                  .filter((m) => m.to > m.from && m.to <= tr.doc.content.size)
                  .map((m) =>
                    Decoration.inline(m.from, m.to, {
                      class: `notation-hit ${m.review ? "notation-hit--review" : ""}`,
                      "data-finding": m.id,
                      title: m.title,
                    }),
                  ),
              );
            // 入力中は位置だけ追従させる（次の検査で作り直す）
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations: (state) => notationKey.getState(state) },
      }),
    ];
  },
});

export function setNotationMarks(editor: Editor, marks: NotationMark[]) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(notationKey, marks).setMeta("addToHistory", false));
}
