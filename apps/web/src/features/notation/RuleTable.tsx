import { api } from "@mf100/convex/api";
import { ruleStrictnessLabels, type RuleDraft } from "@mf100/domain";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { describeError } from "@/lib/errors";
import {
  DataTable,
  EditableSelect,
  EditableSwitch,
  EditableText,
  type Column,
} from "@/ui/DataTable";
import { M3eIcon, M3eIconButton } from "@/ui/m3e";
import { draftOf } from "./RuleEditor";

type Book = FunctionReturnType<typeof api.notation.ruleBook>;
type Rule = Book["rules"][number];

const splitList = (s: string) =>
  s
    .split(/[、,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * ルールの表（広い画面）。統一表記・誤表記・カテゴリ・厳格さ・年度・有効をその場で直せる（担当カテゴリの管理者だけ）。
 * 保存のたびに版が上がり、履歴に「表で編集」として残る。同時に他の人が直していたら競合として止める。
 * 正規表現・例外・説明などの詳しい編集は行の「詳細」から。
 */
export function RuleTable({
  book,
  rules,
  selected,
  onOpen,
}: {
  book: Book;
  rules: readonly Rule[];
  selected: string | null;
  onOpen: (ruleId: string) => void;
}) {
  const save = useMutation(api.notation.save);
  const setEnabled = useMutation(api.notation.setEnabled);
  const canEdit = (r: Rule) => (book.roles[r.categoryCode] ?? "member") !== "member";
  const update = (r: Rule, patch: Partial<RuleDraft>) => async () => {
    try {
      await save({
        rule: { ...draftOf(r), ...patch },
        expectedRevision: r.revision,
        reason: "表で編集",
      });
    } catch (e) {
      throw new Error(describeError(e).message);
    }
  };
  const categories = book.categories.map((c) => ({ value: c.code, label: `${c.code} ${c.name}` }));
  const strictness = Object.entries(ruleStrictnessLabels).map(([value, label]) => ({
    value,
    label,
  }));

  const columns: Column<Rule>[] = [
    {
      key: "id",
      header: "ID",
      rowHeader: true,
      width: "128px",
      sort: (a, b) => a.ruleId.localeCompare(b.ruleId),
      cell: (r) => <span className="small">{r.ruleId}</span>,
    },
    {
      key: "cat",
      header: "カテゴリ",
      width: "208px",
      sort: (a, b) => a.categoryCode.localeCompare(b.categoryCode),
      cell: (r) => (
        <EditableSelect
          label={`${r.ruleId} のカテゴリ`}
          value={r.categoryCode}
          options={categories.filter(
            (c) => c.value === r.categoryCode || (book.roles[c.value] ?? "member") !== "member",
          )}
          disabled={!canEdit(r)}
          onSave={(v) => update(r, { categoryCode: v })()}
        />
      ),
    },
    {
      key: "correct",
      header: "統一表記",
      sort: (a, b) => (a.correct[0] ?? "").localeCompare(b.correct[0] ?? "", "ja"),
      cell: (r) => (
        <EditableText
          label={`${r.ruleId} の統一表記`}
          value={r.correct.join("、")}
          disabled={!canEdit(r)}
          validate={(v) => (splitList(v).length ? null : "統一表記は 1 つ以上必要です")}
          onSave={(v) => update(r, { correct: splitList(v) })()}
        />
      ),
    },
    {
      key: "incorrect",
      header: "誤表記",
      cell: (r) => (
        <>
          <EditableText
            label={`${r.ruleId} の誤表記`}
            value={r.incorrect.join("、")}
            placeholder={r.patterns.length ? "（正規表現のみ）" : "—"}
            disabled={!canEdit(r)}
            validate={(v) =>
              splitList(v).length || r.patterns.length
                ? null
                : "誤表記か正規表現のどちらかが必要です"
            }
            onSave={(v) => update(r, { incorrect: splitList(v) })()}
          />
          {r.patterns.length ? (
            <div className="small muted mono">{r.patterns.map((p) => `/${p}/`).join(" ")}</div>
          ) : null}
        </>
      ),
    },
    {
      key: "strict",
      header: "厳格さ",
      width: "128px",
      sort: (a, b) => a.strictness.localeCompare(b.strictness),
      cell: (r) => (
        <EditableSelect
          label={`${r.ruleId} の厳格さ`}
          value={r.strictness}
          options={strictness}
          disabled={!canEdit(r)}
          onSave={(v) => update(r, { strictness: v as RuleDraft["strictness"] })()}
        />
      ),
    },
    {
      key: "years",
      header: "年度",
      width: "96px",
      cell: (r) => (
        <EditableText
          label={`${r.ruleId} の年度`}
          value={r.years.join(", ")}
          placeholder="全年度"
          disabled={!canEdit(r)}
          validate={(v) =>
            splitList(v.replace(/\s+/g, ",")).every((x) => /^\d{1,3}$/.test(x))
              ? null
              : "数字（MF の回）で入力"
          }
          onSave={(v) => update(r, { years: splitList(v.replace(/\s+/g, ",")).map(Number) })()}
        />
      ),
    },
    {
      key: "enabled",
      header: "有効",
      width: "88px",
      cell: (r) => (
        <EditableSwitch
          label={`${r.ruleId} を有効にする`}
          checked={r.enabled}
          disabled={!canEdit(r)}
          onSave={async (on) => {
            try {
              await setEnabled({ ruleId: r.ruleId, enabled: on, reason: "表で編集" });
            } catch (e) {
              throw new Error(describeError(e).message);
            }
          }}
        />
      ),
    },
    {
      key: "open",
      header: <span className="sr-only">詳細</span>,
      width: "56px",
      cell: (r) => (
        <M3eIconButton
          aria-label={`${r.ruleId} の詳細（説明・例外・履歴）`}
          onClick={() => onOpen(r.ruleId)}
        >
          <M3eIcon name="open_in_full" />
        </M3eIconButton>
      ),
    },
  ];
  return (
    <DataTable
      label="表記ルール"
      columns={columns}
      rows={rules}
      rowKey={(r) => r.ruleId}
      selectedKey={selected}
      empty="ルールがありません"
      className="rule-table"
    />
  );
}
