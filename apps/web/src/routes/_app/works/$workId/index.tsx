import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { formatJst } from "@/lib/format";
import {
  approvalActionLabel,
  closedReasonLabel,
  lifecycleActionLabel,
  lifecycleLabel,
  mediaLabel,
  reviewStateLabel,
} from "@/lib/labels";
import { newRequestId, useAction } from "@/lib/useAction";
import { Field, TextArea } from "@/ui/Field";
import { M3eButton, M3eDialog, M3eIcon } from "@/ui/m3e";
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
      <h1 className="page-title">
        {work.title}
        <span className={`chip ${work.lifecycle === "finalized" ? "chip--ok" : "chip--primary"}`}>
          {lifecycleLabel[work.lifecycle]}
        </span>
        {work.confidentiality === "restricted" ? (
          <span className="chip chip--error">非公開</span>
        ) : null}
        <span className="spacer" />
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
            <M3eIcon slot="icon" name="verified" />
            校了を宣言
          </M3eButton>
        ) : null}
        {can.reopen && work.lifecycle === "finalized" ? (
          <M3eButton variant="outlined" onClick={() => setReopenOpen(true)}>
            <M3eIcon slot="icon" name="lock_open" />
            理由付きで再開
          </M3eButton>
        ) : null}
        {can.edit && work.lifecycle !== "finalized" && work.lifecycle !== "cancelled" ? (
          <Link to="/works/$workId/edit" params={{ workId }}>
            <M3eButton variant="outlined">
              <M3eIcon slot="icon" name="edit" />
              編集
            </M3eButton>
          </Link>
        ) : null}
        {can.edit
          ? lifecycleTargets.map((to) => (
              <M3eButton
                key={to}
                variant="text"
                disabled={doLifecycle.pending}
                onClick={() => void doLifecycle.run(to)}
              >
                <M3eIcon
                  slot="icon"
                  name={to === "active" ? "play_arrow" : to === "on_hold" ? "pause" : "cancel"}
                />
                {lifecycleActionLabel[to]}
              </M3eButton>
            ))
          : null}
        {can.manageAcl ? (
          <Link to="/works/$workId/acl" params={{ workId }}>
            <M3eButton variant="outlined">
              <M3eIcon slot="icon" name="manage_accounts" />
              閲覧権限
            </M3eButton>
          </Link>
        ) : null}
      </h1>

      <div className="grid-2">
        <section className="card">
          <h3>基本情報</h3>
          <dl className="stack small">
            <div>
              <dt className="muted">目的・対象</dt>
              <dd>{work.purpose || "—"}</dd>
            </div>
            <div>
              <dt className="muted">区分 / 媒体 / 旧ID</dt>
              <dd>
                {work.category} / {mediaLabel[work.mediaType]} / {work.legacyId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="muted">納期</dt>
              <dd>{formatJst(work.deadlineAt)}</dd>
            </div>
            <div>
              <dt className="muted">主管・制作統括</dt>
              <dd>{people.managers.map((p) => p?.name).join("、") || "—"}</dd>
            </div>
            <div>
              <dt className="muted">制作者</dt>
              <dd>{people.creators.map((p) => p?.name).join("、") || "—"}</dd>
            </div>
            <div>
              <dt className="muted">校了権限者</dt>
              <dd>{people.approver?.name}</dd>
            </div>
            <div>
              <dt className="muted">閲覧許可（個人 ACL）</dt>
              <dd>{data.activeGrantCount} 件</dd>
            </div>
          </dl>
        </section>
        <section className="card">
          <h3>校了履歴</h3>
          {approvals.length === 0 ? (
            <p className="muted small">まだ校了はありません。</p>
          ) : (
            <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
              {approvals.map((a, i) => (
                <li key={i}>
                  <strong>{approvalActionLabel[a.action]}</strong> — {a.actor?.name}・
                  {formatJst(a.createdAt)}
                  {a.exceptionReason ? (
                    <div className="chip chip--warn">例外理由: {a.exceptionReason}</div>
                  ) : null}
                  {a.reason ? <div className="muted">理由: {a.reason}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <h2 style={{ fontSize: 18, marginTop: 24 }}>版履歴</h2>
      {revisions.length === 0 ? (
        <div className="empty">まだ版が提出されていません。</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>版</th>
              <th>受付</th>
              <th>締切（JST）</th>
              <th>提出</th>
              <th>変更点 / 見てほしい点</th>
              <th>未対応指摘</th>
              <th>専門確認</th>
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
                  {r.kind === "rough" ? (
                    <div className="chip chip--warn">ラフ（通常版とは別区分）</div>
                  ) : null}
                  {work.finalRevisionId === r.id ? (
                    <div className="chip chip--ok">校了版</div>
                  ) : null}
                </td>
                <td>
                  <span className={`chip ${r.reviewState === "open" ? "chip--primary" : ""}`}>
                    {reviewStateLabel[r.reviewState]}
                  </span>
                  {r.reviewClosedReason ? (
                    <div className="small muted">{closedReasonLabel[r.reviewClosedReason]}</div>
                  ) : null}
                </td>
                <td className="small">{formatJst(r.deadlineAt)}</td>
                <td className="small">
                  {r.submitter?.name}
                  <br />
                  {formatJst(r.submittedAt)}
                </td>
                <td className="small">
                  {r.changeSummary || "—"}
                  {r.focusNotes ? <div className="muted">観点: {r.focusNotes}</div> : null}
                </td>
                <td>
                  {r.unresolvedCount > 0 ? (
                    <span className="chip chip--warn">{r.unresolvedCount}</span>
                  ) : (
                    <span className="muted">0</span>
                  )}
                </td>
                <td className="small">
                  {r.pendingChecks.length > 0 ? (
                    <span className="chip chip--warn">未完了 {r.pendingChecks.length}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
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
              未完了の専門確認が {pendingChecks.length} 件あります（{pendingChecks.join("、")}
              ）。確認完了または免除されるまで、理由なしの校了は拒否されます（D6）。
            </div>
          ) : null}
          {blocking > 0 ? (
            <div className="alert--warn alert">
              未対応の指摘が {blocking} 件あります。重大度 critical/major
              の未対応が残っている場合、理由を記入しない限り校了は拒否されます（C6）。
            </div>
          ) : (
            <div className="alert alert--info">未対応の指摘はありません。</div>
          )}
          <Field label="例外校了の理由（重大未解決を残して校了する場合のみ）">
            <TextArea
              value={exceptionReason}
              onChange={(e) => setExceptionReason(e.target.value)}
            />
          </Field>
          <UserPicker
            label="独立確認者（制作者本人が校了する場合のみ・D2 暫定）"
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
          <p className="small muted" style={{ margin: 0 }}>
            過去の校了記録は消えません。再開イベントが監査履歴に追記されます（A-09）。
          </p>
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
          <p className="small muted" style={{ margin: 0 }}>
            割当は「自分の校正待ち」に表示されます。作品の閲覧許可（ACL）は別に管理者が付与する必要があります（D3）。
          </p>
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
