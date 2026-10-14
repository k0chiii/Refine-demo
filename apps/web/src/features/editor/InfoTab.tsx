import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { checkTypeLabels, checkTypes, type CheckType } from "@mf100/domain";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { AclPanel } from "@/features/work/AclPanel";
import { EditWorkDialog } from "@/features/work/EditWorkDialog";
import { formatJstDate, formatJstShort } from "@/lib/format";
import {
  approvalActionLabel,
  checkStateLabel,
  lifecycleActionLabel,
  lifecycleLabel,
  mediaLabel,
} from "@/lib/labels";
import { newRequestId, useAction } from "@/lib/useAction";
import { StatusText } from "@/ui/Chip";
import { Field, Select, TextArea } from "@/ui/Field";
import { M3eButton, M3eDialog, M3eIcon } from "@/ui/m3e";
import { UserPicker } from "@/ui/UserPicker";
import type { WorkData } from "./VersionsTab";

type RevisionData = FunctionReturnType<typeof api.revisions.get>;

/**
 * エディタの引き出し「情報」: 基本情報、専門確認、校了履歴と、制作物に対する操作
 * （校了を宣言、理由付きで再開、校正者を割当、編集、閲覧権限、保留／中止）。
 */
export function InfoTab({
  work,
  revision,
  isAdmin,
}: {
  work: WorkData;
  /** 表示中の版（無ければ null） */
  revision: RevisionData | null;
  isAdmin: boolean;
}) {
  const finalize = useMutation(api.approvals.finalize);
  const reopen = useMutation(api.approvals.reopen);
  const assign = useMutation(api.reviews.assign);
  const changeLifecycle = useMutation(api.works.changeLifecycle);
  const completeCheck = useMutation(api.checks.complete);
  const waiveCheck = useMutation(api.checks.waive);
  const addCheck = useMutation(api.checks.add);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [confirmer, setConfirmer] = useState<string[]>([]);
  const [reopenReason, setReopenReason] = useState("");
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [waiveDraft, setWaiveDraft] = useState<{ checkId: string; reason: string } | null>(null);
  const [addCheckDraft, setAddCheckDraft] = useState<{ type: string; assignee: string[] } | null>(
    null,
  );
  const [requestId] = useState(newRequestId); // 二重クリック・再送でも同じ requestId（A-10）

  const { work: w, people, approvals, can } = work;
  const candidate = work.revisions.find((r) => r.kind === "standard") ?? null; // 並び順は最新 standard が先頭
  const accepting = work.revisions.find((r) => r.id === work.acceptingRevisionId) ?? null;
  const checks = revision?.checks ?? [];
  const pendingChecks = checks.filter((c) => c.state === "pending").length;
  const blocking = candidate?.unresolvedCount ?? 0;
  const lifecycleTargets: Array<"active" | "on_hold" | "cancelled"> =
    w.lifecycle === "active"
      ? ["on_hold", "cancelled"]
      : w.lifecycle === "on_hold" || w.lifecycle === "draft"
        ? ["active", "cancelled"]
        : [];

  const doFinalize = useAction(async () => {
    if (!candidate) return;
    await finalize({
      workId: w.id as Id<"works">,
      revisionId: candidate.id as Id<"revisions">,
      requestId,
      expectedVersion: w.version,
      ...(exceptionReason.trim() ? { exceptionReason: exceptionReason.trim() } : {}),
      ...(confirmer[0] ? { independentConfirmerId: confirmer[0] } : {}),
    });
    setFinalizeOpen(false);
  });
  const doReopen = useAction(async () => {
    await reopen({ workId: w.id as Id<"works">, reason: reopenReason, expectedVersion: w.version });
    setReopenOpen(false);
  });
  const doAssign = useAction(async () => {
    const target = revision?.revision.id ?? accepting?.id;
    if (!target) return;
    await assign({ revisionId: target as Id<"revisions">, reviewerIds, reviewType: "general" });
    setAssignOpen(false);
    setReviewerIds([]);
  });
  const doLifecycle = useAction(async (to: "active" | "on_hold" | "cancelled") => {
    if (
      to === "cancelled" &&
      !window.confirm("この制作物を中止します。元に戻せません。よろしいですか？")
    )
      return;
    await changeLifecycle({ workId: w.id as Id<"works">, to, expectedVersion: w.version });
  });
  const doCompleteCheck = useAction(async (checkId: string) => {
    await completeCheck({ checkId: checkId as Id<"requiredChecks"> });
  });
  const doWaiveCheck = useAction(async () => {
    if (!waiveDraft) return;
    await waiveCheck({
      checkId: waiveDraft.checkId as Id<"requiredChecks">,
      reason: waiveDraft.reason,
    });
    setWaiveDraft(null);
  });
  const doAddCheck = useAction(async () => {
    if (!addCheckDraft || !revision) return;
    await addCheck({
      revisionId: revision.revision.id as Id<"revisions">,
      type: addCheckDraft.type as CheckType,
      ...(addCheckDraft.assignee[0] ? { assigneeId: addCheckDraft.assignee[0] } : {}),
    });
    setAddCheckDraft(null);
  });

  return (
    <div className="info-tab">
      {w.lifecycle !== "active" ? (
        <StatusText tone={w.lifecycle === "finalized" ? "success" : "neutral"}>
          {lifecycleLabel[w.lifecycle]}
        </StatusText>
      ) : null}
      <dl className="info">
        {w.purpose ? (
          <div>
            <dt>目的</dt>
            <dd>{w.purpose}</dd>
          </div>
        ) : null}
        <div>
          <dt>区分</dt>
          <dd>
            {w.category} / {mediaLabel[w.mediaType]}
          </dd>
        </div>
        <div>
          <dt>納期</dt>
          <dd>{formatJstDate(w.deadlineAt)}</dd>
        </div>
        {revision?.revision.focusNotes ? (
          <div>
            <dt>観点</dt>
            <dd>{revision.revision.focusNotes}</dd>
          </div>
        ) : null}
        <div>
          <dt>制作</dt>
          <dd>{people.creators.map((p) => p?.name).join("、") || "—"}</dd>
        </div>
        <div>
          <dt>校了</dt>
          <dd>{people.approver?.name}</dd>
        </div>
        <div>
          <dt>主管</dt>
          <dd>{people.managers.map((p) => p?.name).join("、") || "—"}</dd>
        </div>
        {w.legacyId ? (
          <div>
            <dt>旧ID</dt>
            <dd>{w.legacyId}</dd>
          </div>
        ) : null}
        {w.confidentiality === "restricted" ? (
          <div>
            <dt>機密</dt>
            <dd>非公開・取扱注意</dd>
          </div>
        ) : null}
      </dl>

      <div className="info-tab__actions">
        {can.finalize && w.lifecycle === "active" ? (
          <M3eButton variant="tonal" disabled={!candidate} onClick={() => setFinalizeOpen(true)}>
            <M3eIcon slot="icon" name="verified" />
            校了を宣言
          </M3eButton>
        ) : null}
        {can.reopen && w.lifecycle === "finalized" ? (
          <M3eButton variant="outlined" onClick={() => setReopenOpen(true)}>
            理由付きで再開
          </M3eButton>
        ) : null}
        {can.assign && (revision || accepting) && w.lifecycle === "active" ? (
          <M3eButton variant="outlined" onClick={() => setAssignOpen(true)}>
            校正者を割当
          </M3eButton>
        ) : null}
        {can.edit && w.lifecycle !== "finalized" && w.lifecycle !== "cancelled" ? (
          <M3eButton variant="text" onClick={() => setEditOpen(true)}>
            編集
          </M3eButton>
        ) : null}
        {can.edit
          ? lifecycleTargets.map((to) => (
              <M3eButton key={to} variant="text" onClick={() => void doLifecycle.run(to)}>
                {lifecycleActionLabel[to]}
              </M3eButton>
            ))
          : null}
      </div>

      {revision && (checks.length > 0 || revision.can.addCheck) ? (
        <section className="info-tab__section" aria-label="専門確認">
          <h3 className="info-tab__h">
            専門確認
            {checks.length > 0 ? (
              <StatusText tone={pendingChecks > 0 ? "warning" : "success"} className="ml">
                {pendingChecks > 0 ? `未完了 ${pendingChecks}` : "すべて完了"}
              </StatusText>
            ) : null}
            <span className="spacer" />
            {revision.can.addCheck && !addCheckDraft ? (
              <M3eButton
                variant="text"
                onClick={() => setAddCheckDraft({ type: "photo", assignee: [] })}
              >
                追加
              </M3eButton>
            ) : null}
          </h3>
          <div className="checks">
            {checks.map((c) => (
              <div key={c.id} className={`check ${c.state !== "pending" ? "check--done" : ""}`}>
                <StatusText
                  tone={
                    c.state === "done" ? "success" : c.state === "waived" ? "neutral" : "warning"
                  }
                >
                  {checkStateLabel[c.state]}
                </StatusText>
                <div>
                  {c.label}
                  <div className="small muted">
                    {c.assignee?.name ?? "担当未指定"}
                    {c.doneByUser
                      ? `・${c.state === "waived" ? "免除" : "確認"} ${c.doneByUser.name} ${formatJstShort(c.doneAt ?? 0)}`
                      : ""}
                    {c.note ? `・${c.note}` : ""}
                  </div>
                </div>
                <div className="row">
                  {c.canComplete ? (
                    <M3eButton
                      variant="tonal"
                      disabled={doCompleteCheck.pending}
                      onClick={() => void doCompleteCheck.run(c.id)}
                    >
                      確認完了
                    </M3eButton>
                  ) : null}
                  {c.canWaive ? (
                    <M3eButton
                      variant="text"
                      onClick={() => setWaiveDraft({ checkId: c.id, reason: "" })}
                    >
                      免除
                    </M3eButton>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {waiveDraft ? (
            <div className="stack">
              <Field label="免除の理由（必須・監査に残ります）" required>
                <TextArea
                  value={waiveDraft.reason}
                  onChange={(e) => setWaiveDraft({ ...waiveDraft, reason: e.target.value })}
                />
              </Field>
              <div className="row">
                <span className="spacer" />
                <M3eButton variant="text" onClick={() => setWaiveDraft(null)}>
                  取消
                </M3eButton>
                <M3eButton
                  variant="filled"
                  disabled={doWaiveCheck.pending || !waiveDraft.reason.trim()}
                  onClick={() => void doWaiveCheck.run()}
                >
                  免除を記録
                </M3eButton>
              </div>
            </div>
          ) : null}
          {addCheckDraft ? (
            <div className="stack">
              <Field label="確認の種別">
                <Select
                  value={addCheckDraft.type}
                  onChange={(e) => setAddCheckDraft({ ...addCheckDraft, type: e.target.value })}
                >
                  {checkTypes.map((t) => (
                    <option key={t} value={t}>
                      {checkTypeLabels[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <UserPicker
                label="担当者（任意）"
                single
                value={addCheckDraft.assignee}
                onChange={(ids) => setAddCheckDraft({ ...addCheckDraft, assignee: ids })}
              />
              <div className="row">
                <span className="spacer" />
                <M3eButton variant="text" onClick={() => setAddCheckDraft(null)}>
                  取消
                </M3eButton>
                <M3eButton
                  variant="filled"
                  disabled={doAddCheck.pending}
                  onClick={() => void doAddCheck.run()}
                >
                  追加
                </M3eButton>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {approvals.length > 0 ? (
        <section className="info-tab__section" aria-label="校了履歴">
          <h3 className="info-tab__h">校了履歴</h3>
          <ul className="info__history">
            {approvals.map((a, i) => (
              <li key={i}>
                <StatusText tone={a.action === "reopened" ? "warning" : "success"}>
                  {approvalActionLabel[a.action]}
                </StatusText>
                <span className="small muted">
                  {` ・ ${a.actor?.name ?? ""}・${formatJstShort(a.createdAt)}`}
                </span>
                {a.exceptionReason ? (
                  <div className="small muted">例外理由: {a.exceptionReason}</div>
                ) : null}
                {a.reason ? <div className="small muted">理由: {a.reason}</div> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="info-tab__section" aria-label="閲覧権限">
          <h3 className="info-tab__h">閲覧権限</h3>
          <AclPanel workId={w.id} />
        </section>
      ) : null}

      <EditWorkDialog work={w} open={editOpen} onClose={() => setEditOpen(false)} />

      {/* U-07 校了: 校了版・必須確認・重大未解決・例外理由・実行者を最終確認して確定。二重クリック防止。 */}
      <M3eDialog open={finalizeOpen} onClosed={() => setFinalizeOpen(false)} closeLabel="閉じる">
        <span slot="header">校了を宣言</span>
        <div className="dialog-body">
          <p style={{ margin: 0 }}>
            対象版: <strong>{candidate?.label ?? "（通常版がありません）"}</strong>。宣言者:{" "}
            <strong>{people.approver?.name}</strong>
          </p>
          {candidate && candidate.pendingChecks.length > 0 ? (
            <div className="alert--warn alert">
              <span>
                未完了の専門確認: {candidate.pendingChecks.join("、")}
                。完了または免除されるまで、理由なしの校了はできません。
              </span>
            </div>
          ) : null}
          {blocking > 0 ? (
            <div className="alert--warn alert">
              <span>未対応の指摘が {blocking} 件あります。理由なしでは校了できません。</span>
            </div>
          ) : null}
          <Field label="例外校了の理由（未解決を残す場合のみ）">
            <TextArea
              value={exceptionReason}
              onChange={(e) => setExceptionReason(e.target.value)}
            />
          </Field>
          <UserPicker
            label="独立確認者（制作者本人が校了する場合のみ）"
            single
            value={confirmer}
            onChange={setConfirmer}
            exclude={[w.approverId, ...w.creatorIds]}
          />
          {doFinalize.error ? <div className="alert">{doFinalize.error.message}</div> : null}
        </div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setFinalizeOpen(false)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            disabled={doFinalize.pending || !candidate}
            onClick={() => void doFinalize.run()}
          >
            校了を確定する
          </M3eButton>
        </div>
      </M3eDialog>

      <M3eDialog open={reopenOpen} onClosed={() => setReopenOpen(false)} closeLabel="閉じる">
        <span slot="header">校了を解除して再開</span>
        <div className="dialog-body">
          <Field label="再開理由" required>
            <TextArea
              required
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
            />
          </Field>
        </div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setReopenOpen(false)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            disabled={doReopen.pending || !reopenReason.trim()}
            onClick={() => void doReopen.run()}
          >
            再開する
          </M3eButton>
        </div>
      </M3eDialog>

      <M3eDialog open={assignOpen} onClosed={() => setAssignOpen(false)} closeLabel="閉じる">
        <span slot="header">校正者を割り当て</span>
        <div className="dialog-body">
          <p className="small muted" style={{ margin: 0 }}>
            対象: {revision?.revision.label ?? accepting?.label}
          </p>
          <UserPicker label="校正者" value={reviewerIds} onChange={setReviewerIds} />
        </div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setAssignOpen(false)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            disabled={doAssign.pending || reviewerIds.length === 0}
            onClick={() => void doAssign.run()}
          >
            割り当てる
          </M3eButton>
        </div>
      </M3eDialog>
    </div>
  );
}
