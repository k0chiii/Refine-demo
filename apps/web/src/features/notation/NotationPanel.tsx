import { api } from "@mf100/convex/api";
import { ruleStrictnessLabels, type Finding } from "@mf100/domain";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildPlainText, offsetToPos } from "@/features/writing/plainText";
import { setNotationMarks } from "@/features/writing/plugins";
import { M3eButton, M3eIcon } from "@/ui/m3e";
import { useProofreader } from "./useProofreader";

export interface PlacedFinding extends Finding {
  from: number;
  to: number;
  key: string;
}

export interface NotationCheck {
  state: "loading" | "no-categories" | "checking" | "ready";
  findings: PlacedFinding[];
  truncated: boolean;
  skipped: Array<{ ruleId: string; reason: string }>;
  ruleCount: number;
  categories: string[];
}

const DEBOUNCE_MS = 800;

/**
 * 文章エディタでの表記の検査（AI は使わない・外部に送らない）。
 * 入力が止まって 800ms 後に Worker で検査し、誤表記に波線を引く。無視したものはこの画面を開いている間だけ隠す。
 */
export function useNotationCheck(
  editor: Editor | null,
  workId: string,
): NotationCheck & {
  ignore: (f: PlacedFinding) => void;
} {
  const set = useQuery(api.notation.rulesForWork, { workId });
  const run = useProofreader(set?.rules ?? null);
  const [result, setResult] = useState<Omit<NotationCheck, "state" | "ruleCount" | "categories">>({
    findings: [],
    truncated: false,
    skipped: [],
  });
  const [checking, setChecking] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const version = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!editor || !set) return;
    const check = () => {
      const v = version.current;
      const index = buildPlainText(editor.state.doc);
      setChecking(true);
      void run(index.text).then((r) => {
        if (v !== version.current || editor.isDestroyed) return; // 検査中に書き換わった → 次の検査に任せる
        const size = editor.state.doc.content.size;
        const placed = r.findings.map((f) => ({
          ...f,
          from: offsetToPos(index, f.start, size),
          to: offsetToPos(index, f.end, size),
          key: `${f.ruleId}|${f.original}`,
        }));
        setResult({ findings: placed, truncated: r.truncated, skipped: r.skipped });
        setChecking(false);
      });
    };
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      version.current++;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(check, DEBOUNCE_MS);
    };
    editor.on("update", onUpdate);
    version.current++;
    check();
    return () => {
      editor.off("update", onUpdate);
      window.clearTimeout(timer.current);
    };
  }, [editor, set]);

  const visible = useMemo(
    () => result.findings.filter((f) => !ignored.has(f.key)),
    [result.findings, ignored],
  );
  useEffect(() => {
    if (!editor) return;
    setNotationMarks(
      editor,
      visible.map((f) => ({
        from: f.from,
        to: f.to,
        id: f.fingerprint,
        review: f.needsReview,
        title: `${f.suggestion ? `「${f.suggestion}」に統一` : f.title}（${f.ruleId}）`,
      })),
    );
  }, [editor, visible]);

  const categories = set?.categories ?? [];
  return {
    state: !set
      ? "loading"
      : categories.length === 0
        ? "no-categories"
        : checking
          ? "checking"
          : "ready",
    findings: visible,
    truncated: result.truncated,
    skipped: result.skipped,
    ruleCount: set?.rules.length ?? 0,
    categories,
    ignore: (f) => setIgnored((s) => new Set(s).add(f.key)),
  };
}

/** 文書の [from, to) がまだ指摘の文字のままなら置き換える（1 回の取り消しで戻せる） */
function applyOne(editor: Editor, f: PlacedFinding, tr = editor.state.tr) {
  if (editor.state.doc.textBetween(f.from, f.to) !== f.original) return false;
  if (f.suggestion) tr.insertText(f.suggestion, tr.mapping.map(f.from), tr.mapping.map(f.to));
  return true;
}

export function NotationPanel({
  editor,
  check,
  readOnly,
}: {
  editor: Editor;
  check: ReturnType<typeof useNotationCheck>;
  readOnly: boolean;
}) {
  const [lastFix, setLastFix] = useState<string | null>(null);
  const fixable = check.findings.filter((f) => !f.needsReview && f.suggestion);
  const fix = (f: PlacedFinding) => {
    const tr = editor.state.tr;
    if (!applyOne(editor, f, tr)) return;
    editor.view.dispatch(tr);
    setLastFix(`「${f.original}」→「${f.suggestion}」`);
  };
  const fixAll = () => {
    const tr = editor.state.tr;
    let n = 0;
    // 前から順に、それまでの置き換えで動いた位置を写しながら適用（1 回の取り消しで全部戻る）
    for (const f of [...fixable].sort((a, b) => a.from - b.from)) if (applyOne(editor, f, tr)) n++;
    if (n === 0) return;
    editor.view.dispatch(tr);
    setLastFix(`${n} 件を修正`);
  };
  const go = (f: PlacedFinding) => {
    const { state } = editor;
    if (f.to > state.doc.content.size) return;
    editor.view.dispatch(
      state.tr.setSelection(TextSelection.create(state.doc, f.from, f.to)).scrollIntoView(),
    );
    editor.view.focus();
  };

  if (check.state === "loading") return <p className="panel-pad muted">読み込み中…</p>;
  if (check.state === "no-categories")
    return (
      <div className="panel-pad stack">
        <p className="small">
          この制作物は表記統一のカテゴリが未設定のため、表記の検査をしていません。
        </p>
        <p className="small muted">
          制作物の「編集」でカテゴリ（一般・企画対応・文書 など）を選ぶと検査します。
        </p>
      </div>
    );
  return (
    <div className="panel-pad stack notation-panel">
      <div className="row small muted" role="status">
        {check.state === "checking" ? "検査しています…" : `指摘 ${check.findings.length} 件`}
        <span>
          ・カテゴリ {check.categories.join("・")}・ルール {check.ruleCount} 件
        </span>
      </div>
      {check.truncated ? (
        <p className="small warn-text">文章が長いため、一部だけを検査しました。</p>
      ) : null}
      {check.skipped.length ? (
        <p className="small muted">
          使えないルール {check.skipped.length} 件（正規表現の誤り）を除いて検査しています。
        </p>
      ) : null}
      {!readOnly && fixable.length > 1 ? (
        <M3eButton variant="tonal" onClick={fixAll}>
          <M3eIcon slot="icon" name="auto_fix_high" />
          必須・推奨の {fixable.length} 件をまとめて修正
        </M3eButton>
      ) : null}
      {lastFix ? (
        <div className="row small notation-panel__undo" role="status">
          {lastFix}しました
          <M3eButton
            variant="text"
            onClick={() => {
              editor.commands.undo();
              setLastFix(null);
            }}
          >
            元に戻す
          </M3eButton>
        </div>
      ) : null}
      {check.findings.length === 0 && check.state === "ready" ? (
        <p className="small muted">表記の指摘はありません。</p>
      ) : (
        <ul className="finding-list">
          {check.findings.map((f) => (
            <li
              key={`${f.fingerprint}-${f.from}`}
              className={`finding ${f.needsReview ? "finding--review" : ""}`}
            >
              <button
                type="button"
                className="finding__jump"
                onClick={() => go(f)}
                aria-label={`「${f.original}」へ移動`}
              >
                <span className="finding__orig">{f.original}</span>
                <span aria-hidden="true"> → </span>
                <span className="finding__sugg">{f.suggestion || "（要確認）"}</span>
              </button>
              <span className="finding__meta small muted">
                {f.needsReview ? "要確認・" : `${ruleStrictnessLabels[f.strictness]}・`}
                {f.reason || f.title}
                {f.exceptionNote ? `（例外: ${f.exceptionNote}）` : ""}・{f.ruleId} 版{" "}
                {f.ruleRevision}
              </span>
              <span className="finding__actions">
                {!readOnly && f.suggestion ? (
                  <M3eButton variant="text" onClick={() => fix(f)}>
                    修正
                  </M3eButton>
                ) : null}
                <M3eButton variant="text" onClick={() => check.ignore(f)}>
                  無視
                </M3eButton>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">検査はこの端末の中で行い、文章を外部に送りません。</p>
    </div>
  );
}
