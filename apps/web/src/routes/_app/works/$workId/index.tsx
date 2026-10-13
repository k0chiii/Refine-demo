import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJst, formatJstDate } from "@/lib/format";
import {
  approvalActionLabel,
  closedReasonLabel,
  lifecycleActionLabel,
  lifecycleLabel,
  mediaLabel,
  reviewStateLabel,
} from "@/lib/labels";
import { newRequestId, useAction } from "@/lib/useAction";
import { lifecycleTone } from "../index";
import { Card } from "@/ui/Card";
import { StatusChip, StatusText } from "@/ui/Chip";
import { Field, TextArea } from "@/ui/Field";
import {
  M3eButton,
  M3eDialog,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
} from "@/ui/m3e";
import { PageHeader } from "@/ui/PageHeader";
import { UserPicker } from "@/ui/UserPicker";

export const Route = createFileRoute("/_app/works/$workId/")({ component: WorkDetail });

/** U-03 制作物詳細 + U-07 校了ダイアログ。 */
function WorkDetail() {
  const { workId } = Route.useParams();
  const navigate = useNavigate();
  const data = useQuery(api.works.get, { workId });
  const finalize = useMutation(api.approvals.finalize);
  const reopen = useMutation(api.approvals.reopen);
  const assign = useMutation(api.reviews.assign);
  const changeLifecycle = useMutation(api.works.changeLifecycle);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [exceptionReason, setExceptionReason] = useState("");
  const [confirmer, setConfirmer] = useState<string[]>([]);
  const [reopenReason, setReopenReason] = useState("");
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [requestId] = useState(newRequestId); // 二重クリック・再送でも同じ requestId（A-10）

  // フックは早期 return より前に揃える（React の規則）。data 未取得時は候補版が null になるだけ。
  const candidate = data?.revisions.find((r) => r.kind === "standard") ?? null; // 並び順は最新 standard が先頭
  const doFinalize = useAction(async () => {
    if (!data || !candidate) return;
    await finalize({
      workId: data.work.id as Id<"works">,
      revisionId: candidate.id as Id<"revisions">,
      requestId,
      expectedVersion: data.work.version,
      ...(exceptionReason.trim() ? { exceptionReason: exceptionReason.trim() } : {}),
      ...(confirmer[0] ? { independentConfirmerId: confirmer[0] } : {}),
    });
    setFinalizeOpen(false);
  });
  const doReopen = useAction(async () => {
    if (!data) return;
    await reopen({
      workId: data.work.id as Id<"works">,
      reason: reopenReason,
      expectedVersion: data.work.version,
    });
    setReopenOpen(false);
  });
  const doAssign = useAction(async () => {
    if (!assignFor) return;
    await assign({
      revisionId: assignFor as Id<"revisions">,
      reviewerIds,
      reviewType: "general",
    });
    setAssignFor(null);
    setReviewerIds([]);
  });
  const doLifecycle = useAction(async (to: "active" | "on_hold" | "cancelled") => {
    if (!data) return;
    if (
      to === "cancelled" &&
      !window.confirm("この制作物を中止します。元に戻せません。よろしいですか？")
    )
      return;
    await changeLifecycle({
      workId: data.work.id as Id<"works">,
      to,
      expectedVersion: data.work.version,
    });
  });

  if (data === undefined) return <p className="muted">読み込み中…</p>;
  const { work, revisions, people, approvals, can } = data;
  const blocking = candidate?.unresolvedCount ?? 0;
  const pendingChecks = candidate?.pendingChecks ?? [];
  const lifecycleTargets: Array<"active" | "on_hold" | "cancelled"> =
    work.lifecycle === "active"
      ? ["on_hold", "cancelled"]
      : work.lifecycle === "on_hold" || work.lifecycle === "draft"
        ? ["active", "cancelled"]
        : [];

  return (
    <>
      <PageHeader
        title={work.title}
        meta={
          <>
            <StatusChip tone={lifecycleTone[work.lifecycle] ?? "neutral"}>
              {lifecycleLabel[work.lifecycle]}
            </StatusChip>
            {work.confidentiality === "restricted" ? (
              <M3eIcon name="lock" title="非公開" style={{ fontSize: 18 }} />
            ) : null}
          </>
        }
      >
        {can.submit && work.lifecycle === "active" ? (
          <M3eButton
            variant="filled"
            onClick={() => navigate({ to: "/works/$workId/submit", params: { workId } })}
          >
            <M3eIcon slot="icon" name="upload_file" />
            版を提出
          </M3eButton>
        ) : null}
        {can.finalize && work.lifecycle === "active" ? (
          <M3eButton variant="tonal" disabled={!candidate} onClick={() => setFinalizeOpen(true)}>
            校了を宣言
          </M3eButton>
        ) : null}
        {can.reopen && work.lifecycle === "finalized" ? (
          <M3eButton variant="outlined" onClick={() => setReopenOpen(true)}>
            理由付きで再開
          </M3eButton>
        ) : null}
        {can.edit || can.manageAcl ? (
          <>
            <M3eIconButton aria-label="その他の操作">
              <M3eIcon name="more_vert" />
              <M3eMenuTrigger htmlFor="work-menu" />
            </M3eIconButton>
            <M3eMenu id="work-menu">
              {can.edit && work.lifecycle !== "finalized" && work.lifecycle !== "cancelled" ? (
                <M3eMenuItem
                  onClick={() => navigate({ to: "/works/$workId/edit", params: { workId } })}
                >
                  編集
                </M3eMenuItem>
              ) : null}
              {can.manageAcl ? (
                <M3eMenuItem
                  onClick={() => navigate({ to: "/works/$workId/acl", params: { workId } })}
                >
                  閲覧権限
                </M3eMenuItem>
              ) : null}
              {can.edit
                ? lifecycleTargets.map((to) => (
                    <M3eMenuItem key={to} onClick={() => void doLifecycle.run(to)}>
                      <M3eIcon
                        slot="icon"
                        name={
                          to === "active" ? "play_arrow" : to === "on_hold" ? "pause" : "cancel"
                        }
                      />
                      {lifecycleActionLabel[to]}
                    </M3eMenuItem>
                  ))
                : null}
            </M3eMenu>
          </>
        ) : null}
      </PageHeader>

      <div className="grid-2">
        <Card title="基本情報">
          <dl>
            {work.purpose ? (
              <div>
                <dt>目的・対象</dt>
                <dd>{work.purpose}</dd>
              </div>
            ) : null}
            <div>
              <dt>区分 / 媒体</dt>
              <dd>
                {work.category} / {mediaLabel[work.mediaType]}
              </dd>
            </div>
            <div>
              <dt>納期</dt>
              <dd>{formatJstDate(work.deadlineAt)}</dd>
            </div>
            <div>
              <dt>担当</dt>
              <dd>
                制作 {people.creators.map((p) => p?.name).join("、") || "—"}
                <span className="muted">　校了 </span>
                {people.approver?.name}
                <span className="muted">　主管 </span>
                {people.managers.map((p) => p?.name).join("、") || "—"}
              </dd>
            </div>
          </dl>
        </Card>
        {approvals.length > 0 ? (
          <Card title="校了履歴">
            {
              <ul className="stack" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {approvals.map((a, i) => (
                  <li key={i} className="stack" style={{ gap: 4 }}>
                    <div className="row">
                      <StatusText tone={a.action === "reopened" ? "warning" : "success"}>
                        {approvalActionLabel[a.action]}
                      </StatusText>
                      <span className="small muted">
                        {a.actor?.name}・{formatJst(a.createdAt)}
                      </span>
                    </div>
                    {a.exceptionReason ? (
                      <div className="alert alert--warn">例外理由: {a.exceptionReason}</div>
                    ) : null}
                    {a.reason ? <div className="small muted">理由: {a.reason}</div> : null}
                  </li>
                ))}
              </ul>
            }
          </Card>
        ) : null}
      </div>

      <h2 className="section-title">版履歴</h2>
      {revisions.length === 0 ? (
        <div className="empty">
          <M3eIcon name="upload_file" />
          まだ版が提出されていません。
        </div>
      ) : (
        <div className="table-wrap" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th>版</th>
                <th>受付</th>
                <th>提出</th>
                <th>残作業</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to="/revisions/$revisionId" params={{ revisionId: r.id }}>
                      {r.label}
                    </Link>
                    {work.finalRevisionId === r.id ? (
                      <div>
                        <StatusText tone="success">校了版</StatusText>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <StatusChip
                      tone={
                        r.reviewState === "open"
                          ? "primary"
                          : r.reviewState === "void"
                            ? "error"
                            : "neutral"
                      }
                    >
                      {reviewStateLabel[r.reviewState]}
                    </StatusChip>
                    <div className="small muted">
                      {r.reviewState === "open"
                        ? `締切 ${formatJstDate(r.deadlineAt)}`
                        : (closedReasonLabel[r.reviewClosedReason ?? ""] ?? "")}
                    </div>
                  </td>
                  <td className="small">
                    {r.submitter?.name}
                    <div className="muted">{formatJst(r.submittedAt)}</div>
                  </td>
                  <td>
                    <div className="row">
                      {r.unresolvedCount > 0 ? (
                        <StatusText tone="warning">未対応の指摘 {r.unresolvedCount}</StatusText>
                      ) : null}
                      {r.pendingChecks.length > 0 ? (
                        <StatusText tone="warning">専門確認 {r.pendingChecks.length}</StatusText>
                      ) : null}
                      {r.unresolvedCount === 0 && r.pendingChecks.length === 0 ? (
                        <span className="muted">—</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {can.assign ? (
                      <M3eButton variant="text" onClick={() => setAssignFor(r.id)}>
                        校正者を割当
                      </M3eButton>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* U-07 校了: 校了版・必須確認・重大未解決・例外理由・実行者を最終確認して確定。二重クリック防止。 */}
      <M3eDialog open={finalizeOpen} onClosed={() => setFinalizeOpen(false)} closeLabel="閉じる">
        <span slot="header">校了を宣言</span>
        <div className="dialog-body">
          <p style={{ margin: 0 }}>
            対象版: <strong>{candidate?.label ?? "（通常版がありません）"}</strong>。宣言者:{" "}
            <strong>{people.approver?.name}</strong>（校了権限者）
          </p>
          {pendingChecks.length > 0 ? (
            <div className="alert--warn alert">
              <span>
                未完了の専門確認: {pendingChecks.join("、")}
                。完了または免除されるまで、理由なしの校了はできません。
              </span>
            </div>
          ) : null}
          {blocking > 0 ? (
            <div className="alert--warn alert">
              <span>
                未対応の指摘が {blocking}{" "}
                件あります。重大・重要が残っていると、理由なしでは校了できません。
              </span>
            </div>
          ) : (
            <div className="alert alert--info">未対応の指摘はありません。</div>
          )}
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
            exclude={[work.approverId, ...work.creatorIds]}
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

      <M3eDialog open={assignFor !== null} onClosed={() => setAssignFor(null)} closeLabel="閉じる">
        <span slot="header">校正者を割り当て</span>
        <div className="dialog-body">
          <UserPicker label="校正者" value={reviewerIds} onChange={setReviewerIds} />
        </div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setAssignFor(null)}>
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
    </>
  );
}
