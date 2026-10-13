import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { SubmitDialog } from "@/features/upload/SubmitDialog";
import { formatJstDate, formatJstShort, remaining } from "@/lib/format";
import {
  approvalActionLabel,
  closedReasonLabel,
  lifecycleActionLabel,
  lifecycleLabel,
  mediaLabel,
  reviewStateLabel,
} from "@/lib/labels";
import { newRequestId, useAction } from "@/lib/useAction";
import { StatusText } from "@/ui/Chip";
import { Field, TextArea } from "@/ui/Field";
import {
  M3eActionList,
  M3eButton,
  M3eCard,
  M3eDialog,
  M3eHeading,
  M3eIcon,
  M3eIconButton,
  M3eListAction,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
} from "@/ui/m3e";
import { UserPicker } from "@/ui/UserPicker";

export const Route = createFileRoute("/_app/works/$workId/")({
  validateSearch: (s: Record<string, unknown>): { submit?: boolean } =>
    s.submit === true || s.submit === "true" ? { submit: true } : {},
  component: WorkDetail,
});

/**
 * U-03 制作物詳細 + U-07 校了。
 * 主役は版: 最新の版へ 1 クリックで行ける大きな導線と版の履歴。基本情報・校了は右の補助パネル（M3 supporting pane）。
 * 版提出はダイアログ（`?submit=1` で開く）。
 */
function WorkDetail() {
  const { workId } = Route.useParams();
  const { submit } = Route.useSearch();
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
  const openSubmit = (open: boolean) =>
    void navigate({
      to: "/works/$workId",
      params: { workId },
      search: (s) => {
        const { submit: _drop, ...rest } = s;
        return open ? { ...rest, submit: true } : rest;
      },
      replace: !open,
    });

  if (data === undefined) return <p className="muted">読み込み中…</p>;
  const { work, revisions, people, approvals, can } = data;
  const latest =
    revisions.find((r) => r.id === data.acceptingRevisionId) ??
    revisions.find((r) => r.reviewState !== "void") ??
    null;
  const history = revisions.filter((r) => r.id !== latest?.id);
  const blocking = candidate?.unresolvedCount ?? 0;
  const pendingChecks = candidate?.pendingChecks ?? [];
  const lifecycleTargets: Array<"active" | "on_hold" | "cancelled"> =
    work.lifecycle === "active"
      ? ["on_hold", "cancelled"]
      : work.lifecycle === "on_hold" || work.lifecycle === "draft"
        ? ["active", "cancelled"]
        : [];
  const openRevision = (id: string) =>
    void navigate({ to: "/revisions/$revisionId", params: { revisionId: id } });

  return (
    <div className="work">
      <header className="page-header work__header">
        <M3eIconButton
          className="list-detail__back"
          aria-label="一覧へ戻る"
          onClick={() => void navigate({ to: "/works", search: (s) => s })}
        >
          <M3eIcon name="arrow_back" />
        </M3eIconButton>
        <M3eHeading
          variant="headline"
          size="small"
          level={1}
          emphasized
          className="page-header__title"
        >
          {work.title}
        </M3eHeading>
        {work.lifecycle !== "active" ? (
          <StatusText tone={work.lifecycle === "finalized" ? "success" : "neutral"}>
            {lifecycleLabel[work.lifecycle]}
          </StatusText>
        ) : null}
        {work.confidentiality === "restricted" ? (
          <M3eIcon name="lock" title="非公開" style={{ fontSize: 18 }} />
        ) : null}
        <span className="spacer" />
        {can.submit && work.lifecycle === "active" ? (
          <M3eButton variant="filled" onClick={() => openSubmit(true)}>
            <M3eIcon slot="icon" name="upload_file" />
            版を提出
          </M3eButton>
        ) : null}
        {can.edit || can.manageAcl ? (
          <M3eIconButton aria-label="その他の操作">
            <M3eIcon name="more_vert" />
            <M3eMenuTrigger htmlFor="work-menu" />
          </M3eIconButton>
        ) : null}
      </header>
      {can.edit || can.manageAcl ? (
        <M3eMenu id="work-menu" positionX="before">
          {can.edit && work.lifecycle !== "finalized" && work.lifecycle !== "cancelled" ? (
            <M3eMenuItem
              onClick={() => navigate({ to: "/works/$workId/edit", params: { workId } })}
            >
              編集
            </M3eMenuItem>
          ) : null}
          {can.manageAcl ? (
            <M3eMenuItem onClick={() => navigate({ to: "/works/$workId/acl", params: { workId } })}>
              閲覧権限
            </M3eMenuItem>
          ) : null}
          {can.edit
            ? lifecycleTargets.map((to) => (
                <M3eMenuItem key={to} onClick={() => void doLifecycle.run(to)}>
                  {lifecycleActionLabel[to]}
                </M3eMenuItem>
              ))
            : null}
        </M3eMenu>
      ) : null}

      <div className="work__body">
        <div className="work__main">
          {!latest ? (
            <div className="empty">
              <M3eIcon name="upload_file" />
              まだ版がありません。
            </div>
          ) : (
            <M3eCard
              variant="outlined"
              actionable
              className="latest"
              aria-label={`最新の版 ${latest.label} を開く`}
              onClick={() => openRevision(latest.id)}
            >
              <div slot="content" className="latest__content">
                <div>
                  <div className="latest__label">
                    {latest.label}
                    {work.finalRevisionId === latest.id ? (
                      <StatusText tone="success" className="ml">
                        校了版
                      </StatusText>
                    ) : null}
                  </div>
                  <div className="muted">
                    {latest.reviewState === "open"
                      ? `受付中・締切 ${formatJstDate(latest.deadlineAt)}（${remaining(latest.deadlineAt)}）`
                      : latest.reviewState === "void"
                        ? reviewStateLabel.void
                        : `受付終了${latest.reviewClosedReason ? `・${closedReasonLabel[latest.reviewClosedReason]}` : ""}`}
                    {latest.unresolvedCount > 0 ? `・未対応 ${latest.unresolvedCount}` : ""}
                    {latest.pendingChecks.length > 0
                      ? `・専門確認 ${latest.pendingChecks.length}`
                      : ""}
                  </div>
                </div>
                <M3eIcon name="arrow_forward" className="latest__arrow" />
              </div>
            </M3eCard>
          )}
          {latest && can.assign ? (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <M3eButton variant="text" onClick={() => setAssignFor(latest.id)}>
                校正者を割当
              </M3eButton>
            </div>
          ) : null}
          {history.length > 0 ? (
            <>
              <h2 className="section-title">これまでの版</h2>
              <M3eActionList className="list" aria-label="版履歴">
                {history.map((r) => (
                  <M3eListAction
                    key={r.id}
                    className="list__item list__item--done"
                    onClick={() => openRevision(r.id)}
                  >
                    <span className="list__headline">
                      {r.label}
                      {work.finalRevisionId === r.id ? (
                        <StatusText tone="success" className="ml">
                          校了版
                        </StatusText>
                      ) : null}
                    </span>
                    <span slot="supporting-text">
                      {r.reviewState === "void"
                        ? reviewStateLabel.void
                        : r.reviewState === "open"
                          ? `受付中・締切 ${formatJstDate(r.deadlineAt)}`
                          : (closedReasonLabel[r.reviewClosedReason ?? ""] ?? "受付終了")}
                      ・{r.submitter?.name}・{formatJstShort(r.submittedAt)}
                    </span>
                    {r.unresolvedCount > 0 ? (
                      <span slot="trailing" className="meta">
                        未対応 {r.unresolvedCount}
                      </span>
                    ) : null}
                  </M3eListAction>
                ))}
              </M3eActionList>
            </>
          ) : null}
        </div>

        <aside className="work__info" aria-label="基本情報">
          <dl className="info">
            {work.purpose ? (
              <div>
                <dt>目的</dt>
                <dd>{work.purpose}</dd>
              </div>
            ) : null}
            <div>
              <dt>区分</dt>
              <dd>
                {work.category} / {mediaLabel[work.mediaType]}
              </dd>
            </div>
            <div>
              <dt>納期</dt>
              <dd>{formatJstDate(work.deadlineAt)}</dd>
            </div>
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
          </dl>
          {can.finalize && work.lifecycle === "active" ? (
            <M3eButton variant="tonal" disabled={!candidate} onClick={() => setFinalizeOpen(true)}>
              <M3eIcon slot="icon" name="verified" />
              校了を宣言
            </M3eButton>
          ) : null}
          {can.reopen && work.lifecycle === "finalized" ? (
            <M3eButton variant="outlined" onClick={() => setReopenOpen(true)}>
              理由付きで再開
            </M3eButton>
          ) : null}
          {approvals.length > 0 ? (
            <ul className="info__history">
              {approvals.map((a, i) => (
                <li key={i}>
                  <StatusText tone={a.action === "reopened" ? "warning" : "success"}>
                    {approvalActionLabel[a.action]}
                  </StatusText>
                  <span className="small muted">
                    　{a.actor?.name}・{formatJstShort(a.createdAt)}
                  </span>
                  {a.exceptionReason ? (
                    <div className="small muted">例外理由: {a.exceptionReason}</div>
                  ) : null}
                  {a.reason ? <div className="small muted">理由: {a.reason}</div> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </aside>
      </div>

      <SubmitDialog
        workId={workId}
        open={submit === true && can.submit && work.lifecycle === "active"}
        onClose={() => openSubmit(false)}
      />

      {/* U-07 校了: 校了版・必須確認・重大未解決・例外理由・実行者を最終確認して確定。二重クリック防止。 */}
      <M3eDialog open={finalizeOpen} onClosed={() => setFinalizeOpen(false)} closeLabel="閉じる">
        <span slot="header">校了を宣言</span>
        <div className="dialog-body">
          <p style={{ margin: 0 }}>
            対象版: <strong>{candidate?.label ?? "（通常版がありません）"}</strong>。宣言者:{" "}
            <strong>{people.approver?.name}</strong>
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
    </div>
  );
}
