import { api } from "@mf100/convex/api";
import type { RuleDraft } from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useState } from "react";
import { formatJst } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { Checkbox, Field, TextInput } from "@/ui/Field";
import { Loading } from "@/ui/Loading";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eCard } from "@m3e/react/card";
import { M3eFilterChip, M3eFilterChipSet } from "@m3e/react/chips";
import { M3eHeading } from "@m3e/react/heading";
import { M3eIcon } from "@m3e/react/icon";
import { StatusText } from "@/ui/Chip";
import { draftOf, RuleEditor } from "./RuleEditor";
import { toast } from "@/lib/toast";

type Book = FunctionReturnType<typeof api.notation.ruleBook>;
type Proposal = FunctionReturnType<typeof api.notation.proposals>[number];

const kindLabel = { new: "追加", change: "変更", report: "誤表記の報告" } as const;
const statusLabel = { open: "未処理", approved: "承認", rejected: "却下" } as const;

/**
 * 変更提案の一覧。担当者は承認・却下・編集して承認ができ、まとめて処理もできる。
 * 一般ユーザーには自分の提案（賛同したものを含む）だけが見える。
 */
export function ProposalsPanel({ book }: { book: Book }) {
  const [status, setStatus] = useState<"open" | "approved" | "rejected">("open");
  const list = useQuery(api.notation.proposals, { status });
  const decide = useMutation(api.notation.decide);
  const decideMany = useMutation(api.notation.decideMany);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<Proposal | null>(null);
  const one = useAction(async (id: string, decision: "approve" | "reject") => {
    await decide({ proposalId: id, decision, ...(note ? { note } : {}) });
    toast(decision === "approve" ? "承認してルールに反映しました" : "却下しました");
  });
  const many = useAction(async (decision: "approve" | "reject") => {
    const r = await decideMany({ proposalIds: picked, decision, ...(note ? { note } : {}) });
    setPicked([]);
    toast(
      `${r.done.length} 件を${decision === "approve" ? "承認" : "却下"}しました${r.failed.length ? `（${r.failed.length} 件は処理できませんでした）` : ""}`,
    );
  });
  const decidable = (list ?? []).filter((p) => p.canDecide);
  const editInitial = useMemo(
    () => (editing ? initialFor(book, editing) : undefined),
    [editing?.id],
  );

  return (
    <div className="stack">
      <div className="row">
        <M3eFilterChipSet aria-label="状態">
          {(["open", "approved", "rejected"] as const).map((s) => (
            <M3eFilterChip key={s} selected={status === s} onClick={() => setStatus(s)}>
              {statusLabel[s]}
            </M3eFilterChip>
          ))}
        </M3eFilterChipSet>
        <span className="spacer" />
        {status === "open" && decidable.length ? (
          <>
            <Field label="判断のメモ（任意）" className="field--narrow">
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <M3eButton
              variant="text"
              disabled={!picked.length || many.pending}
              onClick={() => void many.run("reject")}
            >
              選んだものを却下
            </M3eButton>
            <M3eButton
              variant="tonal"
              disabled={!picked.length || many.pending}
              onClick={() => void many.run("approve")}
            >
              選んだものを承認（{picked.length}）
            </M3eButton>
          </>
        ) : null}
      </div>
      {list === undefined ? (
        <Loading label="提案を読み込んでいます" />
      ) : list.length === 0 ? (
        <div className="empty">
          {status === "open" ? "未処理の提案はありません" : "該当する提案はありません"}
        </div>
      ) : (
        <div className="proposal-list">
          {list.map((p) => (
            <M3eCard key={p.id} variant="filled" className="proposal">
              <div slot="header" className="proposal__head">
                {p.canDecide ? (
                  <Checkbox
                    checked={picked.includes(p.id)}
                    onChange={(on) =>
                      setPicked((xs) => (on ? [...xs, p.id] : xs.filter((x) => x !== p.id)))
                    }
                    label={<span className="sr-only">「{p.title}」を選ぶ</span>}
                  />
                ) : null}
                <StatusText className="proposal__kind">{kindLabel[p.kind]}</StatusText>
                <M3eHeading variant="title" size="small" level={3} className="proposal__title">
                  {p.categoryCode} {p.title}
                  {p.ruleId ? <span className="small muted">（{p.ruleId}）</span> : null}
                </M3eHeading>
              </div>
              <div slot="content" className="proposal__content">
                {p.correct.length || p.incorrect.length || p.patterns.length ? (
                  <p>
                    {p.correct.length ? <b>{p.correct.join(" / ")}</b> : null}
                    {p.incorrect.length || p.patterns.length ? (
                      <span className="muted">
                        {" "}
                        ← {[...p.incorrect, ...p.patterns].join(" / ")}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                {p.reason ? <p className="small">{p.reason}</p> : null}
                {p.contextHidden ? (
                  <p className="small muted">元の制作物を閲覧できないため、文脈は表示しません</p>
                ) : p.context.quote ? (
                  <p className="small proposal__quote">
                    「{p.context.quote}」
                    {p.context.surrounding ? (
                      <span className="muted"> — {p.context.surrounding}</span>
                    ) : null}
                  </p>
                ) : null}
                <p className="small muted">
                  {p.proposer.name}・{formatJst(p.proposedAt)}
                  {p.supporters.length ? `・賛同 ${p.supporters.length}` : ""}
                  {p.decider ? `・${statusLabel[p.status]}: ${p.decider.name}` : ""}
                  {p.decisionNote ? `（${p.decisionNote}）` : ""}
                  {p.resultRuleId ? `・ルール ${p.resultRuleId} 改訂 ${p.resultRevision}` : ""}
                </p>
              </div>
              {p.canDecide ? (
                <div slot="actions" className="proposal__actions">
                  <M3eButton
                    variant="text"
                    disabled={one.pending}
                    onClick={() => void one.run(p.id, "reject")}
                  >
                    却下
                  </M3eButton>
                  <M3eButton variant="text" onClick={() => setEditing(p)}>
                    <M3eIcon slot="icon" name="edit" />
                    編集して承認
                  </M3eButton>
                  <M3eButton
                    variant="filled"
                    disabled={one.pending || (p.kind === "report" && p.correct.length === 0)}
                    onClick={() => void one.run(p.id, "approve")}
                  >
                    承認
                  </M3eButton>
                </div>
              ) : null}
            </M3eCard>
          ))}
        </div>
      )}
      <M3eDialog
        open={editing !== null}
        onClosed={() => setEditing(null)}
        closeLabel="閉じる"
        dismissible
        className="dialog--full"
      >
        <span slot="header">編集して承認</span>
        <div className="dialog-body">
          {editing && editInitial ? (
            <RuleEditor
              book={book}
              rule={
                editing.ruleId
                  ? (book.rules.find((r) => r.ruleId === editing.ruleId) ?? null)
                  : null
              }
              initial={editInitial}
              onDone={() => setEditing(null)}
              onDecide={async (draft) => {
                await decide({
                  proposalId: editing.id,
                  decision: "approve",
                  edited: draft,
                  ...(note ? { note } : {}),
                });
                toast("編集した内容で承認しました");
              }}
            />
          ) : null}
        </div>
      </M3eDialog>
    </div>
  );
}

function initialFor(book: Book, p: Proposal): RuleDraft {
  const cur = p.ruleId ? book.rules.find((r) => r.ruleId === p.ruleId) : undefined;
  const base: RuleDraft = cur
    ? draftOf(cur)
    : {
        ruleId: "",
        categoryCode: p.categoryCode,
        title: p.title,
        description: p.reason,
        correct: [],
        incorrect: [],
        patterns: [],
        exceptions: [],
        language: "ja",
        scopes: [],
        years: [],
        priority: 0,
        strictness: "required",
        enabled: true,
      };
  return {
    ...base,
    correct: p.correct.length ? p.correct : base.correct,
    incorrect: p.incorrect.length || p.patterns.length ? p.incorrect : base.incorrect,
    patterns: p.incorrect.length || p.patterns.length ? p.patterns : base.patterns,
    exceptions: p.exceptions.length ? p.exceptions : base.exceptions,
  };
}
