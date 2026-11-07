import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

/** 自動の書式（入力規則）で変えた記録。Tiptap の入力規則が tr に付ける meta と同じ形 */
interface RuleRecord {
  transform: Transaction;
  from: number;
  to: number;
  text: string;
}
interface State {
  rule: RuleRecord;
  /** 規則の直後に足された tr（StarterKit の TrailingNode が見出しの後ろに足す空の段落など） */
  appended: Transaction[];
}

const key = new PluginKey<State | null>("mf100UndoAutoFormat");

/**
 * 行頭の「# 」「- 」などで自動で付いた書式は、直後の Cmd/Ctrl+Z でその変換だけを取り消す（打った「# 」は文字で残る。
 * Google ドキュメント・Notion と同じ）。
 *
 * Tiptap にも undoInputRule があるが、文末の見出しでは TrailingNode が appendTransaction で段落を足し、
 * その tr で入力規則の記録が消えるため効かない。ここでは足された tr も覚えておき、まとめて戻す。
 * 変換の直後でなければ何もしない（ふつうの取り消しへ）。
 */
export const UndoAutoFormat = Extension.create({
  name: "mf100UndoAutoFormat",
  priority: 1000,
  addProseMirrorPlugins() {
    return [
      new Plugin<State | null>({
        key,
        state: {
          init: () => null,
          apply(tr, prev, _old, state) {
            for (const p of state.plugins) {
              if (!p.spec.isInputRules) continue;
              const rule = tr.getMeta(p) as RuleRecord | undefined;
              if (rule) return { rule, appended: [] };
            }
            if (prev && tr.getMeta("appendedTransaction"))
              return { ...prev, appended: [...prev.appended, tr] };
            return tr.docChanged || tr.selectionSet ? null : prev;
          },
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-z": ({ editor }) => {
        const s = key.getState(editor.state);
        if (!s) return false;
        const tr = editor.state.tr;
        try {
          for (const t of [...s.appended].reverse().concat(s.rule.transform))
            for (let i = t.steps.length - 1; i >= 0; i--) tr.step(t.steps[i]!.invert(t.docs[i]!));
        } catch {
          return false;
        }
        const { from, to, text } = s.rule;
        if (text) tr.replaceWith(from, to, editor.schema.text(text, tr.doc.resolve(from).marks()));
        else tr.delete(from, to);
        editor.view.dispatch(tr);
        return true;
      },
    };
  },
});
