import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import {
  checklistFor,
  checkTypeLabels,
  checkTypes,
  isEndOfJstDayDeadline,
  revisionDeclarationItems,
  socialPlatformLabels,
  teamPath,
  workGenreLabels,
  workSubGenreLabel,
  type CheckType,
} from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState, type ReactNode } from "react";
import { AclPanel } from "@/features/work/AclPanel";
import { ReviewersDialog } from "@/features/work/ReviewersDialog";
import { EditWorkDialog } from "@/features/work/EditWorkDialog";
import { formatDeadline, formatJstDate, formatJstShort } from "@/lib/format";
import {
  approvalActionLabel,
  assignmentLabel,
  checkStateLabel,
  lifecycleActionLabel,
  lifecycleLabel,
  mediaLabel,
} from "@/lib/labels";
import { toast } from "@/lib/toast";
import { newRequestId, useAction } from "@/lib/useAction";
import { StatusText } from "@/ui/Chip";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eList, M3eListItem } from "@m3e/react/list";
import { UserPicker } from "@/ui/UserPicker";
import { RevisionFiles } from "./RevisionFiles";
import type { WorkData } from "./VersionsTab";

type RevisionData = FunctionReturnType<typeof api.revisions.get>;

/**
 * エディタの引き出し「情報」: 基本情報、専門確認、独立確認、校了履歴と、制作物に対する操作
 * （校了を宣言、理由付きで再開、校正者の割り当て、編集、閲覧権限、保留／中止）。
 */
export function InfoTab({
  work,
  revision,
  shownArtifactId = null,
}: {
  work: WorkData;
  /** 表示中の版（無ければ null） */
  revision: RevisionData | null;
  /** 紙面に出している添付（この版のファイルの一覧で印を付ける） */
  shownArtifactId?: string | null;
}) {
  const finalize = useMutation(api.approvals.finalize);
  const reopen = useMutation(api.approvals.reopen);
  const changeLifecycle = useMutation(api.works.changeLifecycle);
  const updateWork = useMutation(api.works.update);
  const completeCheck = useMutation(api.checks.complete);
  const waiveCheck = useMutation(api.checks.waive);
  const addCheck = useMutation(api.checks.add);
  const confirmIndependently = useMutation(api.approvals.confirm);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reviewersOpen, setReviewersOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [autoNote, setAutoNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmNote, setConfirmNote] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [waiveDraft, setWaiveDraft] = useState<{ checkId: string; reason: string } | null>(null);
  const [addCheckDraft, setAddCheckDraft] = useState<{ type: string; assignee: string[] } | null>(
    null,
  );
  const [requestId] = useState(newRequestId); // 二重クリック・再送でも同じ requestId（A-10）

  const { work: w, people, approvals, approval, can } = work;
  const [purposeDraft, setPurposeDraft] = useState(w.purpose ?? "");
  useEffect(() => {
    setPurposeDraft(w.purpose ?? "");
  }, [w.purpose, w.version]);
  const me = approval.approvers.find((a) => a.isMe) ?? null;
  const multiApprovers = approval.approvers.length > 1;
  // この宣言で「校了とみなす人数」に届くか（届かなければ宣言の記録だけで、校了にはまだ進まない）
  const reachesNow = approval.declaredCount + 1 >= approval.quorum;
  // 独立確認（D2）: 制作者本人が校了する制作物では、ほかの人の確認の記録が校了の前に要る（判定はサーバー）
  const confirmation = useQuery(api.approvals.confirmationStatus, {
    workId: w.id as Id<"works">,
  });
  const confirmationTarget =
    work.revisions.find((r) => r.id === confirmation?.candidateRevisionId) ?? null;
  // 独立確認が要るのは、制作者本人でもある校了者が宣言するとき（ほかの校了者の宣言は止めない）
  const needsConfirmation = confirmation?.requiredForMe === true && confirmation.valid === null;
  const candidate = work.revisions.find((r) => r.kind === "standard") ?? null; // 並び順は最新 standard が先頭
  const checks = revision?.checks ?? [];
  const reviewers = revision?.assignments ?? [];
  const reviewersDone = reviewers.filter(
    (a) => a.state === "responded" || a.state === "excused",
  ).length;
  const pendingChecks = checks.filter((c) => c.state === "pending").length;
  // 人の未対応のコメント（自動校正は校了を止めないので別に数える）
  const blocking = Math.max(0, (candidate?.unresolvedCount ?? 0) - (candidate?.openBotCount ?? 0));
  const lifecycleTargets: Array<"active" | "on_hold" | "cancelled"> =
    w.lifecycle === "active"
      ? ["on_hold", "cancelled"]
      : w.lifecycle === "on_hold" || w.lifecycle === "draft"
        ? ["active", "cancelled"]
        : [];

  // SNS 投稿の制作物: どのアカウント（本体の設定）で投稿するか
  const profiles = useQuery(api.social.list, w.mediaType === "sns" ? {} : "skip");
  const doFinalize = useAction(async () => {
    if (!candidate) return;
    const done = await finalize({
      workId: w.id as Id<"works">,
      revisionId: candidate.id as Id<"revisions">,
      requestId,
      expectedVersion: w.version,
      ...(exceptionReason.trim() ? { exceptionReason: exceptionReason.trim() } : {}),
      ...(autoNote.trim() ? { autoProofreadNote: autoNote.trim() } : {}),
    });
    setFinalizeOpen(false);
    // 人数に届かない宣言は記録だけ。届いたら校了（状態の表示が変わる）
    if (!done.finalized) toast(`校了を宣言しました（${done.declared}/${done.quorum} 人）`);
  });
  const doConfirm = useAction(async () => {
    if (!confirmation?.candidateRevisionId) return;
    await confirmIndependently({
      revisionId: confirmation.candidateRevisionId as Id<"revisions">,
      ...(confirmNote.trim() ? { note: confirmNote.trim() } : {}),
    });
    setConfirmOpen(false);
    setConfirmNote("");
  });
  const doReopen = useAction(async () => {
    await reopen({ workId: w.id as Id<"works">, reason: reopenReason, expectedVersion: w.version });
    setReopenOpen(false);
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

  const teams = useQuery(api.teams.list, {});
  const teamNames = (ids: readonly string[]) =>
    ids.map((id) => teamPath(id, teams ?? []) ?? "（不明な担当）").join("、");
  const names = (list: ReadonlyArray<{ name: string } | undefined>) =>
    list.map((p) => p?.name ?? "（不明なユーザー）").join("、");
  type Row = readonly [string, ReactNode];
  /** 無い任意の項目は出さない（Notion の空欄と同じ） */
  const optional = (label: string, value: ReactNode | null | undefined): Row[] =>
    value === null || value === undefined || value === "" ? [] : [[label, value]];
  const propGroups: Array<{ title: string; rows: Row[] }> = [
    {
      title: "基本",
      rows: [
        ["制作物名", w.title] as Row,
        ...optional("大ジャンル", w.genre ? workGenreLabels[w.genre] : null),
        ...optional("小ジャンル", workSubGenreLabel(w.subGenre)),
        ["区分 / 媒体", `${w.category} / ${mediaLabel[w.mediaType]}`] as Row,
        ...optional("タグ", w.tags?.length ? w.tags.join("、") : null),
        ...(w.confidentiality === "restricted" ? ([["機密", "非公開・取扱注意"]] as Row[]) : []),
      ],
    },
    {
      title: "担当と人",
      rows: [
        ...optional("担当", w.ownerTeamId ? teamNames([w.ownerTeamId]) : null),
        ...optional("制作担当", w.productionTeamIds.length ? teamNames(w.productionTeamIds) : null),
        ...optional("関係担当", w.relatedTeamIds.length ? teamNames(w.relatedTeamIds) : null),
        ["制作者", names(people.creators) || "—"] as Row,
        ["校了する人", <ApproverList key="approvers" approval={approval} />] as Row,
        ["統括", names(people.managers) || "—"] as Row,
        ...optional("関係者", people.stakeholders.length ? names(people.stakeholders) : null),
      ],
    },
    {
      title: "日程と入稿",
      rows: [
        ["■仕上がり日", w.finishAt === undefined ? "—" : formatDeadline(w.finishAt)] as Row,
        ["校了目標日", w.deadlineAt === undefined ? "—" : formatDeadline(w.deadlineAt)] as Row,
        ...optional(
          "入稿日・投稿日・印刷日",
          w.publishAt === undefined
            ? null
            : isEndOfJstDayDeadline(w.publishAt)
              ? formatJstDate(w.publishAt - 1)
              : formatJstShort(w.publishAt),
        ),
        ...optional(
          "入稿の有無",
          w.requiresPrinterSubmission === undefined
            ? null
            : w.requiresPrinterSubmission
              ? "あり"
              : "なし",
        ),
        ...optional(
          "印刷する部数/枚数/個数",
          w.printQuantity === undefined ? null : w.printQuantity.toLocaleString("ja-JP"),
        ),
        ...optional("サイズ・尺", w.sizeOrLength),
        ...optional("制作日数", w.productionDays === undefined ? null : `${w.productionDays} 日`),
      ],
    },
    {
      title: "SNS",
      rows:
        w.mediaType === "sns"
          ? ([
              [
                "アカウント",
                (() => {
                  const p = profiles?.find((x) => x.id === w.socialProfileId);
                  return p ? `${socialPlatformLabels[p.platform]} @${p.username}` : "未設定";
                })(),
              ],
            ] as Row[])
          : [],
    },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="info-tab">
      {w.lifecycle !== "active" ? (
        <StatusText tone={w.lifecycle === "finalized" ? "success" : "neutral"}>
          {lifecycleLabel[w.lifecycle]}
        </StatusText>
      ) : null}
      {/* 基本情報は項目名（overline）と値の M3 リスト（読むだけ。M3 に表は無い。§49）。直すのは「編集」のダイアログ。
          節は Notion の制作物 DB に揃えて 基本／担当と人／日程と入稿（SNS は媒体が SNS のときだけ。利用者決定 2026-10-17。docs/NOTION_ALIGNMENT.md） */}
      {propGroups.map((g) => (
        <section key={g.title} className="info-tab__section" aria-label={g.title}>
          <h2 className="info-tab__h">{g.title}</h2>
          {g.title === "基本" ? (
            can.edit && w.lifecycle !== "finalized" && w.lifecycle !== "cancelled" ? (
              <Field label="目的・用途" hint="登録後にここで記入・更新します">
                <TextArea value={purposeDraft} onChange={(e) => setPurposeDraft(e.target.value)} />
                <div className="row" style={{ marginTop: "0.5rem" }}>
                  <M3eButton
                    variant="tonal"
                    disabled={purposeDraft === (w.purpose ?? "")}
                    onClick={() =>
                      void updateWork({
                        workId: w.id as Id<"works">,
                        expectedVersion: w.version,
                        patch: { purpose: purposeDraft.trim() },
                      })
                    }
                  >
                    保存
                  </M3eButton>
                </div>
              </Field>
            ) : (
              <p className="small" style={{ margin: "0 0 0.75rem" }}>
                目的・用途: {w.purpose?.trim() ? w.purpose : "未入力"}
              </p>
            )
          ) : null}
          <M3eList className="list prop-list">
            {g.rows.map(([label, value]) => (
              <M3eListItem key={label} className="list__item">
                <span slot="overline">{label}</span>
                <span className="prop-list__value">{value}</span>
              </M3eListItem>
            ))}
          </M3eList>
        </section>
      ))}
      {/* 「現在の版」の申告（写真・めい・指針外の色の使用）と、表示中の版の提出前の確認。Notion の版 DB の formula に相当 */}
      {work.currentDeclarations || (revision?.revision.selfChecks?.length ?? 0) > 0 ? (
        <section className="info-tab__section" aria-label="現在の版の申告">
          <h2 className="info-tab__h">現在の版の申告</h2>
          {work.currentDeclarations ? (
            <div className="row info-tab__flags">
              {revisionDeclarationItems.map((it) => (
                <StatusText
                  key={it.key}
                  tone={work.currentDeclarations![it.key] ? "warning" : "neutral"}
                >
                  {it.label}: {work.currentDeclarations![it.key] ? "あり" : "なし"}
                </StatusText>
              ))}
            </div>
          ) : null}
          {revision?.revision.selfChecks?.length ? (
            <p className="small muted" style={{ margin: 0 }}>
              {revision.revision.label} の提出前の確認: {revision.revision.selfChecks.length} /{" "}
              {checklistFor(w.genre).length} 項目を確認済み
            </p>
          ) : null}
        </section>
      ) : null}
      {revision ? <RevisionFiles artifacts={revision.artifacts} shownId={shownArtifactId} /> : null}

      <div className="info-tab__actions">
        {can.finalize && w.lifecycle === "active" && approval.canDeclare ? (
          // 校了権限者の「いまやる 1 つ」なので filled（M3 Usability。§35 A-20。利用者決定 2026-10-15）。
          // 校了者が複数のときは、まだ宣言していない校了者にだけ出す
          <M3eButton variant="filled" disabled={!candidate} onClick={() => setFinalizeOpen(true)}>
            <M3eIcon slot="icon" name="verified" />
            校了を宣言
          </M3eButton>
        ) : null}
        {can.finalize && w.lifecycle === "active" && me?.declared ? (
          <StatusText tone="success" icon="check_circle">
            宣言済み
          </StatusText>
        ) : null}
        {multiApprovers && w.lifecycle === "active" ? (
          <StatusText tone="neutral">
            校了 {approval.declaredCount}/{approval.quorum} 人
          </StatusText>
        ) : null}
        {can.reopen && w.lifecycle === "finalized" ? (
          <M3eButton variant="outlined" onClick={() => setReopenOpen(true)}>
            理由付きで再開
          </M3eButton>
        ) : null}
        {can.editReviewers ? (
          <M3eButton variant="outlined" onClick={() => setReviewersOpen(true)}>
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

      {/* 校正者ごとの状態。読了印として、校正完了にした人と時刻を制作者・主管が見られる（割り当てる権限のある人だけ） */}
      {revision && revision.can.assign && revision.assignments.length > 0 ? (
        <section className="info-tab__section" aria-label="校正者">
          <h2 className="info-tab__h">
            校正者
            <StatusText
              tone={reviewersDone === reviewers.length ? "success" : "neutral"}
              className="ml"
            >
              校正完了 {reviewersDone} / {reviewers.length}
            </StatusText>
          </h2>
          <div className="checks">
            {reviewers.map((a) => {
              const at = a.state === "responded" ? a.respondedAt : a.viewedAt;
              return (
                <div
                  key={a.reviewerId}
                  className={`check ${a.state === "responded" || a.state === "excused" ? "check--done" : ""}`}
                >
                  <StatusText
                    tone={a.state === "responded" ? "success" : "neutral"}
                    icon={a.state === "responded" ? "check_circle" : undefined}
                  >
                    {assignmentLabel[a.state]}
                  </StatusText>
                  <div>
                    {a.reviewer?.name ?? a.reviewerId}
                    {at !== undefined ? (
                      <span className="small muted">・{formatJstShort(at)}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {revision && (checks.length > 0 || revision.can.addCheck) ? (
        <section className="info-tab__section" aria-label="専門確認">
          <h2 className="info-tab__h">
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
          </h2>
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

      {confirmation?.required && w.lifecycle === "active" ? (
        <section className="info-tab__section" aria-label="独立確認">
          <h2 className="info-tab__h">
            独立確認
            <StatusText tone={confirmation.valid ? "success" : "warning"} className="ml">
              {confirmation.valid ? "確認済み" : "未確認"}
            </StatusText>
            <span className="spacer" />
            {confirmation.canConfirm ? (
              <M3eButton variant="tonal" onClick={() => setConfirmOpen(true)}>
                <M3eIcon slot="icon" name="fact_check" />
                独立確認をする
              </M3eButton>
            ) : null}
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            制作者が校了するには、ほかの人の確認が必要です
          </p>
          {confirmation.valid ? (
            <div className="small">
              {confirmation.valid.confirmer?.name ?? "（不明なユーザー）"}・
              {formatJstShort(confirmation.valid.confirmedAt)}
              {confirmation.valid.note ? `・${confirmation.valid.note}` : ""}
            </div>
          ) : null}
          {confirmation.confirmedByMe && !confirmation.valid ? (
            <div className="small muted">役割が変わったため、この確認は無効です</div>
          ) : null}
        </section>
      ) : null}

      {approvals.length > 0 ? (
        <section className="info-tab__section" aria-label="校了履歴">
          <h2 className="info-tab__h">校了履歴</h2>
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

      {can.viewAudit ? (
        <section className="info-tab__section" aria-label="閲覧権限">
          <h2 className="info-tab__h">閲覧権限</h2>
          <AclPanel workId={w.id} readOnly={!can.manageAcl} />
        </section>
      ) : null}

      <EditWorkDialog work={w} open={editOpen} onClose={() => setEditOpen(false)} />

      {/* U-07 校了: 校了版・必須確認・重大未解決・例外理由・実行者を最終確認して確定。二重クリック防止。 */}
      <M3eDialog open={finalizeOpen} onClosed={() => setFinalizeOpen(false)} closeLabel="閉じる">
        <span slot="header">校了を宣言</span>
        <div className="dialog-body">
          <p style={{ margin: 0 }}>
            対象版: <strong>{candidate?.label ?? "（通常版がありません）"}</strong>。宣言者:{" "}
            <strong>{me?.user?.name ?? people.approver?.name}</strong>
          </p>
          {multiApprovers ? (
            <StatusText tone={reachesNow ? "success" : "neutral"}>
              校了する人 {approval.approvers.length} 人中 {approval.quorum} 人で校了・宣言済み{" "}
              {approval.declaredCount} 人{reachesNow ? "・この宣言で校了" : ""}
            </StatusText>
          ) : null}
          {candidate && candidate.pendingChecks.length > 0 ? (
            <div className="alert--warn alert">
              <span>専門確認が残っています: {candidate.pendingChecks.join("、")}</span>
            </div>
          ) : null}
          {blocking > 0 ? (
            <div className="alert--warn alert">
              <span>未対応のコメント {blocking} 件</span>
            </div>
          ) : null}
          {candidate && candidate.openBotCount > 0 ? (
            <>
              <div className="alert--warn alert">
                <span>未確認の自動校正 {candidate.openBotCount} 件（校了の記録に残ります）</span>
              </div>
              <Field label="自動校正についてのメモ（任意）">
                <TextInput value={autoNote} onChange={(e) => setAutoNote(e.target.value)} />
              </Field>
            </>
          ) : null}
          <Field
            label="例外校了の理由"
            hint="未対応のコメントや専門確認を残して校了するときだけ書きます"
          >
            <TextArea
              value={exceptionReason}
              onChange={(e) => setExceptionReason(e.target.value)}
            />
          </Field>
          {confirmation?.requiredForMe ? (
            confirmation.valid ? (
              <p className="small" style={{ margin: 0 }}>
                <StatusText tone="success">独立確認済み</StatusText>{" "}
                {confirmation.valid.confirmer?.name ?? "（不明なユーザー）"}・
                {formatJstShort(confirmation.valid.confirmedAt)}
              </p>
            ) : (
              <div className="alert--warn alert">
                <span>ほかの人（主管・校正者）の確認が済むまで校了できません</span>
              </div>
            )
          ) : null}
        </div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setFinalizeOpen(false)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            disabled={doFinalize.pending || !candidate || needsConfirmation}
            onClick={() => void doFinalize.run()}
          >
            {reachesNow ? "校了を確定する" : "校了を宣言する"}
          </M3eButton>
        </div>
      </M3eDialog>

      {/* 独立確認（D2）: 確認者本人の操作で記録する。校了する人が確認者を選ぶのではない */}
      <M3eDialog open={confirmOpen} onClosed={() => setConfirmOpen(false)} closeLabel="閉じる">
        <span slot="header">独立確認をする</span>
        <div className="dialog-body">
          <p style={{ margin: 0 }}>
            <strong>{confirmationTarget?.label ?? "（通常版がありません）"}</strong>{" "}
            の内容を確認したことを記録します
          </p>
          <Field label="確認のメモ（任意）" hint="確認した範囲など。500 文字まで">
            <TextArea
              value={confirmNote}
              maxLength={500}
              onChange={(e) => setConfirmNote(e.target.value)}
            />
          </Field>
        </div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setConfirmOpen(false)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            disabled={doConfirm.pending || !confirmation?.candidateRevisionId}
            onClick={() => void doConfirm.run()}
          >
            確認したことを記録
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
          <p style={{ margin: 0 }}>中止すると元に戻せません</p>
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

      {reviewersOpen ? (
        <ReviewersDialog
          workId={w.id}
          title={w.title}
          initialIds={w.reviewerIds ?? []}
          onClose={() => setReviewersOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * 校了者の一覧。校了者が複数のときは、誰が宣言したか（チェック）と「n 人中 q 人で校了」の規則を添える。
 * 数えているのは、進行中は校了候補の版、校了後は校了した版の宣言
 */
function ApproverList({ approval }: { approval: WorkData["approval"] }) {
  const multi = approval.approvers.length > 1;
  return (
    <span className="info-tab__approvers">
      {approval.approvers.map((a, i) => (
        <StatusText
          key={a.user?.id ?? i}
          tone={a.declared ? "success" : "neutral"}
          icon={a.declared ? "check_circle" : "pending"}
          title={a.declared ? "宣言済み" : "未宣言"}
        >
          {a.user?.name ?? "（不明なユーザー）"}
        </StatusText>
      ))}
      {multi ? (
        <span className="small muted">
          {approval.approvers.length} 人中 {approval.quorum} 人で校了（{approval.declaredCount}{" "}
          人が宣言済み）
        </span>
      ) : null}
    </span>
  );
}
