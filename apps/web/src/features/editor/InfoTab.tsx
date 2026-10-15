import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { checkTypeLabels, checkTypes, socialPlatformLabels, type CheckType } from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
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
import { describeError } from "@/lib/errors";
import { newRequestId, useAction } from "@/lib/useAction";
import { EditableSelect, EditableText } from "@/ui/DataTable";
import { StatusText } from "@/ui/Chip";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { M3eButton, M3eDialog, M3eIcon } from "@/ui/m3e";
import { UserPicker } from "@/ui/UserPicker";
import type { WorkData } from "./VersionsTab";

type RevisionData = FunctionReturnType<typeof api.revisions.get>;

/**
 * エディタの引き出し「情報」: 基本情報、専門確認、校了履歴と、制作物に対する操作
 * （校了を宣言、理由付きで再開、校正者の割り当て、編集、閲覧権限、保留／中止）。
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
  const [cancelOpen, setCancelOpen] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [autoNote, setAutoNote] = useState("");
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
  // 人の未対応のコメント（自動校正は校了を止めないので別に数える）
  const blocking = Math.max(0, (candidate?.unresolvedCount ?? 0) - (candidate?.openBotCount ?? 0));
  const lifecycleTargets: Array<"active" | "on_hold" | "cancelled"> =
    w.lifecycle === "active"
      ? ["on_hold", "cancelled"]
      : w.lifecycle === "on_hold" || w.lifecycle === "draft"
        ? ["active", "cancelled"]
        : [];

  const update = useMutation(api.works.update);
  // SNS 投稿の制作物: どのアカウント（本体の設定）で投稿するか
  const profiles = useQuery(api.social.list, w.mediaType === "sns" ? {} : "skip");
  const editable = can.edit && w.lifecycle !== "finalized" && w.lifecycle !== "cancelled";
  const patch = async (p: {
    purpose?: string;
    category?: string;
    legacyId?: string;
    socialProfileId?: string | null;
  }) => {
    try {
      await update({ workId: w.id as Id<"works">, expectedVersion: w.version, patch: p });
    } catch (e) {
      throw new Error(describeError(e).message);
    }
  };
  const doFinalize = useAction(async () => {
    if (!candidate) return;
    await finalize({
      workId: w.id as Id<"works">,
      revisionId: candidate.id as Id<"revisions">,
      requestId,
      expectedVersion: w.version,
      ...(exceptionReason.trim() ? { exceptionReason: exceptionReason.trim() } : {}),
      ...(confirmer[0] ? { independentConfirmerId: confirmer[0] } : {}),
      ...(autoNote.trim() ? { autoProofreadNote: autoNote.trim() } : {}),
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
    await changeLifecycle({ workId: w.id as Id<"works">, to, expectedVersion: w.version });
    if (to === "cancelled") setCancelOpen(false);
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
      {/* 基本情報の表。目的・区分・旧ID はその場で直せる（編集できる人だけ。版番号で競合を検出） */}
      <table className="prop-table">
        <tbody>
          <tr>
            <th scope="row">名称</th>
            <td>{w.title}</td>
          </tr>
          <tr>
            <th scope="row">目的</th>
            <td>
              <EditableText
                label="目的"
                value={w.purpose}
                disabled={!editable}
                placeholder="未入力"
                onSave={(v) => patch({ purpose: v })}
              />
            </td>
          </tr>
          <tr>
            <th scope="row">区分</th>
            <td>
              <EditableText
                label="区分"
                value={w.category}
                disabled={!editable}
                validate={(v) => (v.trim() ? null : "区分を入力してください")}
                onSave={(v) => patch({ category: v })}
              />
              <span className="small muted"> / {mediaLabel[w.mediaType]}</span>
            </td>
          </tr>
          <tr>
            <th scope="row">納期</th>
            <td>{formatJstDate(w.deadlineAt)}</td>
          </tr>
          {revision?.revision.focusNotes ? (
            <tr>
              <th scope="row">観点</th>
              <td>{revision.revision.focusNotes}</td>
            </tr>
          ) : null}
          <tr>
            <th scope="row">制作者</th>
            <td>{people.creators.map((p) => p?.name).join("、") || "—"}</td>
          </tr>
          <tr>
            <th scope="row">校了権限者</th>
            <td>{people.approver?.name}</td>
          </tr>
          <tr>
            <th scope="row">主管</th>
            <td>{people.managers.map((p) => p?.name).join("、") || "—"}</td>
          </tr>
          <tr>
            <th scope="row">旧ID</th>
            <td>
              <EditableText
                label="旧ID"
                value={w.legacyId ?? ""}
                disabled={!editable}
                placeholder="なし"
                onSave={(v) => patch({ legacyId: v })}
              />
            </td>
          </tr>
          {w.mediaType === "sns" ? (
            <tr>
              <th scope="row">SNS</th>
              <td>
                <EditableSelect
                  label="SNS アカウント"
                  value={w.socialProfileId ?? ""}
                  disabled={!editable || profiles === undefined}
                  options={[
                    { value: "", label: "未設定" },
                    ...(profiles ?? []).map((p) => ({
                      value: p.id,
                      label: `${socialPlatformLabels[p.platform]} @${p.username}`,
                    })),
                  ]}
                  onSave={(v) => patch({ socialProfileId: v || null })}
                />
              </td>
            </tr>
          ) : null}
          {w.confidentiality === "restricted" ? (
            <tr>
              <th scope="row">機密</th>
              <td>非公開・取扱注意</td>
            </tr>
          ) : null}
        </tbody>
      </table>

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
            校正者を割り当てる
          </M3eButton>
        ) : null}
        {can.edit && w.lifecycle !== "finalized" && w.lifecycle !== "cancelled" ? (
          <M3eButton variant="text" onClick={() => setEditOpen(true)}>
            編集
          </M3eButton>
        ) : null}
        {can.edit
          ? lifecycleTargets.map((to) => (
              <M3eButton
                key={to}
                variant="text"
                onClick={() =>
                  to === "cancelled" ? setCancelOpen(true) : void doLifecycle.run(to)
                }
              >
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
                      確認を完了
                    </M3eButton>
                  ) : null}
                  {c.canWaive ? (
                    <M3eButton
                      variant="text"
                      onClick={() => setWaiveDraft({ checkId: c.id, reason: "" })}
                    >
                      免除する
                    </M3eButton>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {waiveDraft ? (
            <div className="stack">
              <Field label="免除の理由" hint="監査の記録に残ります" required>
                <TextArea
                  value={waiveDraft.reason}
                  onChange={(e) => setWaiveDraft({ ...waiveDraft, reason: e.target.value })}
                />
              </Field>
              <div className="row">
                <span className="spacer" />
                <M3eButton variant="text" onClick={() => setWaiveDraft(null)}>
                  キャンセル
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
                  キャンセル
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
              <span>未対応のコメントが {blocking} 件あります。理由なしでは校了できません。</span>
            </div>
          ) : null}
          {candidate && candidate.openBotCount > 0 ? (
            <>
              <div className="alert--warn alert">
                <span>
                  自動校正のコメントが {candidate.openBotCount}{" "}
                  件、まだ確認されていません。校了はできますが、件数とメモが校了の記録に残ります。
                </span>
              </div>
              <Field label="自動校正についてのメモ（任意）">
                <TextInput value={autoNote} onChange={(e) => setAutoNote(e.target.value)} />
              </Field>
            </>
          ) : null}
          <Field
            label="例外校了の理由"
            hint="未解決のコメントや専門確認を残して校了するときだけ書きます"
          >
            <TextArea
              value={exceptionReason}
              onChange={(e) => setExceptionReason(e.target.value)}
            />
          </Field>
          <UserPicker
            label="独立確認者"
            hint="制作者本人が校了するときだけ選びます"
            single
            value={confirmer}
            onChange={setConfirmer}
            exclude={[w.approverId, ...w.creatorIds]}
          />
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

      <M3eDialog open={cancelOpen} onClosed={() => setCancelOpen(false)} closeLabel="閉じる">
        <span slot="header">この制作物を中止しますか？</span>
        <div className="dialog-body">
          <p style={{ margin: 0 }}>
            中止すると、版の提出・校正・校了ができなくなります。中止は取り消せません。
          </p>
        </div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setCancelOpen(false)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            disabled={doLifecycle.pending}
            onClick={() => void doLifecycle.run("cancelled")}
          >
            中止する
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
