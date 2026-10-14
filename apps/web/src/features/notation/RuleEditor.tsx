import { api } from "@mf100/convex/api";
import {
  compileRulePattern,
  ruleLanguageLabels,
  ruleStrictnessLabels,
  validateRuleDraft,
  type ExceptionCondition,
  type RuleDraft,
} from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { formatJst } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import {
  M3eButton,
  M3eIcon,
  M3eIconButton,
  M3eSnackbar,
  M3eExpansionPanel,
  M3eList,
  M3eListItem,
} from "@/ui/m3e";
import { Card } from "@/ui/Card";

type Book = FunctionReturnType<typeof api.notation.ruleBook>;
type Rule = Book["rules"][number];

const lines = (xs: readonly string[]) => xs.join("\n");
const parseLines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

export function emptyDraft(categoryCode: string): RuleDraft {
  return {
    ruleId: "",
    categoryCode,
    title: "",
    description: "",
    correct: [],
    incorrect: [],
    patterns: [],
    exceptions: [],
    language: "ja",
    scopes: [],
    years: [100],
    priority: 0,
    strictness: "required",
    enabled: true,
  };
}

export function draftOf(r: Rule): RuleDraft {
  const {
    revision: _r,
    createdBy: _cb,
    updatedBy: _ub,
    createdAt: _ca,
    updatedAt: _ua,
    publishedAt: _p,
    ...d
  } = r;
  return d;
}

const exceptionKinds: Array<[ExceptionCondition["kind"], string]> = [
  ["phrase", "この語句の中なら除外"],
  ["before", "直前がこの正規表現なら除外"],
  ["after", "直後がこの正規表現なら除外"],
  ["category", "このカテゴリでは適用しない"],
];

/**
 * ルールの編集（管理者）・変更提案（一般ユーザー）を同じ画面で。
 * 管理者でない人の「保存」は提案になり、承認されるまでルールには反映されない。
 */
export function RuleEditor({
  book,
  rule,
  initial,
  onDone,
  onDecide,
}: {
  book: Book;
  /** 既存ルール（新規は null） */
  rule: Rule | null;
  /** 新規・提案の編集承認のときの初期値 */
  initial?: RuleDraft;
  onDone: () => void;
  /** 提案の「編集して承認」から開いたとき（保存の代わりにこれを呼ぶ） */
  onDecide?: (draft: RuleDraft) => Promise<void>;
}) {
  const save = useMutation(api.notation.save);
  const setEnabled = useMutation(api.notation.setEnabled);
  const propose = useMutation(api.notation.propose);
  const start = () =>
    initial ?? (rule ? draftOf(rule) : emptyDraft(book.categories[0]?.code ?? "A1"));
  const [d, setD] = useState<RuleDraft>(start);
  const [reason, setReason] = useState("");
  const [text, setText] = useState(() => ({
    correct: lines(start().correct),
    incorrect: lines(start().incorrect),
    patterns: lines(start().patterns),
    years: start().years.join(", "),
  }));
  useEffect(() => {
    const s = start();
    setD(s);
    setText({
      correct: lines(s.correct),
      incorrect: lines(s.incorrect),
      patterns: lines(s.patterns),
      years: s.years.join(", "),
    });
    setReason("");
  }, [rule?.ruleId, rule?.revision, initial]);

  const role = book.roles[d.categoryCode] ?? "member";
  const canEdit =
    role !== "member" && (!rule || (book.roles[rule.categoryCode] ?? "member") !== "member");
  const draft: RuleDraft = {
    ...d,
    ruleId: d.ruleId.trim() || autoId(book, d.categoryCode),
    correct: parseLines(text.correct),
    incorrect: parseLines(text.incorrect),
    patterns: parseLines(text.patterns),
    years: text.years
      .split(/[,、\s]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  };
  const errors = validateRuleDraft(draft);
  const patternErrors = draft.patterns
    .map((p) => [p, compileRulePattern(p)] as const)
    .filter(([, c]) => !c.ok)
    .map(([p, c]) => `${p}: ${c.ok ? "" : c.reason}`);

  const submit = useAction(async () => {
    if (onDecide) {
      await onDecide(draft);
      onDone();
      return;
    }
    if (canEdit) {
      await save({ rule: draft, expectedRevision: rule?.revision ?? 0, reason });
      M3eSnackbar.open(rule ? "ルールを更新しました" : "ルールを追加しました", { duration: 3000 });
    } else {
      const r = await propose({
        kind: rule ? "change" : "new",
        categoryCode: draft.categoryCode,
        ...(rule ? { ruleId: rule.ruleId } : {}),
        title: draft.title,
        correct: draft.correct,
        incorrect: draft.incorrect,
        patterns: draft.patterns,
        exceptions: draft.exceptions,
        reason,
      });
      M3eSnackbar.open(
        r.merged
          ? "同じ内容の提案があったので、賛同として追加しました"
          : "提案を送りました。カテゴリの担当者が承認すると反映されます",
        { duration: 5000 },
      );
    }
    onDone();
  });
  const toggle = useAction(async () => {
    if (!rule) return;
    await setEnabled({ ruleId: rule.ruleId, enabled: !rule.enabled, reason });
  });
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  return (
    <div className="rule-editor">
      <div className="rule-editor__grid">
        <Field label="カテゴリ" required>
          <Select value={d.categoryCode} onChange={(e) => set("categoryCode", e.target.value)}>
            {book.categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ルール ID" hint={rule ? "変更できません" : "空なら自動で付けます"}>
          <TextInput
            value={d.ruleId}
            disabled={!!rule}
            placeholder={autoId(book, d.categoryCode)}
            onChange={(e) => set("ruleId", e.target.value)}
          />
        </Field>
      </div>
      <Field label="項目名" required>
        <TextInput value={d.title} onChange={(e) => set("title", e.target.value)} />
      </Field>
      <div className="rule-editor__grid">
        <Field label="統一表記（先頭が修正候補）" required hint="1 行に 1 つ">
          <TextArea
            rows={2}
            value={text.correct}
            onChange={(e) => setText((t) => ({ ...t, correct: e.target.value }))}
          />
        </Field>
        <Field label="誤表記（文字どおり）" hint="1 行に 1 つ">
          <TextArea
            rows={2}
            value={text.incorrect}
            onChange={(e) => setText((t) => ({ ...t, incorrect: e.target.value }))}
          />
        </Field>
      </div>
      <Field
        label="正規表現"
        hint="1 行に 1 つ。置換に $1 を使えます。入れ子の繰り返し（(a+)+ など）は使えません"
        {...(patternErrors.length ? { error: patternErrors.join(" / ") } : {})}
      >
        <TextArea
          rows={2}
          className="mono"
          value={text.patterns}
          onChange={(e) => setText((t) => ({ ...t, patterns: e.target.value }))}
        />
      </Field>
      <Field label="説明（指摘の理由として表示）">
        <TextArea
          rows={2}
          value={d.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
      <Card title="例外" className="rule-editor__exceptions">
        {d.exceptions.map((ex, i) => (
          <div key={i} className="rule-editor__exception">
            <Select
              aria-label="例外の種類"
              value={ex.kind}
              onChange={(e) =>
                set(
                  "exceptions",
                  d.exceptions.map((x, k) =>
                    k === i ? { ...x, kind: e.target.value as ExceptionCondition["kind"] } : x,
                  ),
                )
              }
            >
              {exceptionKinds.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <TextInput
              aria-label="条件"
              placeholder={ex.kind === "category" ? "例: C" : "例: 物|もの"}
              value={ex.value}
              onChange={(e) =>
                set(
                  "exceptions",
                  d.exceptions.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)),
                )
              }
            />
            <TextInput
              aria-label="メモ"
              placeholder="メモ（例: 本動詞は漢字）"
              value={ex.note ?? ""}
              onChange={(e) =>
                set(
                  "exceptions",
                  d.exceptions.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)),
                )
              }
            />
            <M3eIconButton
              aria-label="この例外を削除"
              onClick={() =>
                set(
                  "exceptions",
                  d.exceptions.filter((_, k) => k !== i),
                )
              }
            >
              <M3eIcon name="close" />
            </M3eIconButton>
          </div>
        ))}
        <M3eButton
          variant="text"
          onClick={() => set("exceptions", [...d.exceptions, { kind: "phrase", value: "" }])}
        >
          <M3eIcon slot="icon" name="add" />
          例外を追加
        </M3eButton>
      </Card>
      <M3eExpansionPanel className="expansion">
        <span slot="header">適用範囲・年度・厳格さ・言語</span>
        <div className="rule-editor__grid">
          <Field label="厳格さ">
            <Select
              value={d.strictness}
              onChange={(e) => set("strictness", e.target.value as RuleDraft["strictness"])}
            >
              {Object.entries(ruleStrictnessLabels).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="言語">
            <Select
              value={d.language}
              onChange={(e) => set("language", e.target.value as RuleDraft["language"])}
            >
              {Object.entries(ruleLanguageLabels).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="年度（MF の回）" hint="空なら全年度。例: 100">
            <TextInput
              inputMode="numeric"
              value={text.years}
              onChange={(e) => setText((t) => ({ ...t, years: e.target.value }))}
            />
          </Field>
          <Field label="優先度" hint="同じ箇所で競合したとき大きい方">
            <TextInput
              type="number"
              value={String(d.priority)}
              onChange={(e) => set("priority", Number(e.target.value) || 0)}
            />
          </Field>
        </div>
        <Field
          label="適用範囲（カテゴリ。空なら所属カテゴリが選ばれていれば適用）"
          hint="カンマ区切り。例: B, C"
        >
          <TextInput
            value={d.scopes.join(", ")}
            onChange={(e) =>
              set(
                "scopes",
                e.target.value
                  .split(/[,、\s]+/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
      </M3eExpansionPanel>
      <Field label={canEdit || onDecide ? "変更の理由（履歴に残ります）" : "提案の理由"}>
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {errors.length ? (
        <p className="error-text small" role="alert">
          {errors.join("／")}
        </p>
      ) : null}
      <div className="row">
        {rule && canEdit && !onDecide ? (
          <M3eButton variant="text" disabled={toggle.pending} onClick={() => void toggle.run()}>
            <M3eIcon slot="icon" name={rule.enabled ? "block" : "check_circle"} />
            {rule.enabled ? "無効にする" : "有効にする"}
          </M3eButton>
        ) : null}
        <span className="spacer" />
        <M3eButton variant="text" onClick={onDone}>
          キャンセル
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={submit.pending || errors.length > 0}
          onClick={() => void submit.run()}
        >
          {onDecide ? "この内容で承認" : canEdit ? "保存" : rule ? "変更を提案" : "追加を提案"}
        </M3eButton>
      </div>
      {rule ? <RuleHistory ruleId={rule.ruleId} /> : null}
    </div>
  );
}

function autoId(book: Book, code: string): string {
  const taken = new Set(book.rules.map((r) => r.ruleId));
  let n = book.rules.filter((r) => r.categoryCode === code).length + 1;
  let id = `${code}-${String(n).padStart(4, "0")}`;
  while (taken.has(id)) id = `${code}-${String(++n).padStart(4, "0")}`;
  return id;
}

const opLabel: Record<string, string> = {
  create: "作成",
  update: "変更",
  disable: "無効化",
  enable: "有効化",
  import: "取り込み",
  proposal: "提案の承認",
};

function RuleHistory({ ruleId }: { ruleId: string }) {
  const hist = useQuery(api.notation.ruleHistory, { ruleId });
  if (!hist?.length) return null;
  return (
    <M3eExpansionPanel className="expansion rule-history">
      <span slot="header">変更履歴（{hist.length}）</span>
      <M3eList aria-label="変更履歴">
        {hist.map((h) => (
          <M3eListItem key={h.revision}>
            <span slot="overline">
              版 {h.revision}・{opLabel[h.operation] ?? h.operation}
            </span>
            {h.rule.correct[0]} ← {[...h.rule.incorrect, ...h.rule.patterns].join(" / ")}
            <span slot="supporting-text">
              {h.actor.name}・{formatJst(h.at)}
              {h.reason ? `・${h.reason}` : ""}
            </span>
          </M3eListItem>
        ))}
      </M3eList>
    </M3eExpansionPanel>
  );
}
