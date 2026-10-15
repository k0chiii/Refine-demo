import {
  revisionLabel,
  type ApprovalConfirmation,
  type ApprovalEvent,
  evaluateIndependentConfirmation,
  findValidConfirmation,
  isAllowed,
  isIndependentOf,
  latestStandardRevision,
  normalizeConfirmationNote,
  requiresIndependentConfirmation,
  assertExpectedVersion,
  assertReopenReason,
  DomainError,
  evaluateFinalization,
  type ApprovalPolicy,
  type Principal,
  type Work,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { idempotent, loadAuthorizedWork } from "../shared.ts";
import { excerpt, notify, personName, workStakeholders } from "./notifications.ts";

export interface FinalizeWorkInput {
  workId: string;
  revisionId: string;
  exceptionReason?: string;
  expectedVersion?: number;
  requestId?: string;
  /** 制度承認後に差し替えるポリシー。未指定なら安全側の既定値。 */
  policy?: ApprovalPolicy;
  /**
   * 自動校正の未確認の指摘が残っているときの確認メモ（校了は止めない。記録だけ残す）。
   * 既存の校了条件（重大な指摘・専門確認・自己校了）はこれで緩めない。
   */
  autoProofreadNote?: string;
}

export interface FinalizeOutcome {
  work: Work;
  event: ApprovalEvent;
}

/**
 * 校了宣言（C3 / C6 / F-09 / U-07 / A-08 / A-10）。
 * 本人認証・対象制作物・校了権限・最終版・重大未解決・例外理由をサーバーで一致確認して確定する。
 */
export async function finalizeWork(
  ctx: AppContext,
  principal: Principal,
  input: FinalizeWorkInput,
): Promise<FinalizeOutcome> {
  const { work, grants } = await loadAuthorizedWork(ctx, principal, input.workId, "work.finalize");
  return idempotent(ctx, `finalizeWork:${work.id}`, input.requestId, async () => {
    assertExpectedVersion(work, input.expectedVersion);
    const revisions = await ctx.revisions.listByWork(work.id);
    const threads = await ctx.threads.listByRevision(input.revisionId);
    const checks = await ctx.checks.listByRevision(input.revisionId);
    // D2: 独立確認は確認者本人の操作で保存された記録だけを使う（申告された ID は受け取らない）
    const confirmations = await ctx.approvals.listConfirmationsByRevision(input.revisionId);
    const notBefore = lastReopenedAt(await ctx.approvals.listByWork(work.id));
    const req: Parameters<typeof evaluateFinalization>[0] = {
      work,
      revisionId: input.revisionId,
      revisions,
      threads,
      checks,
      actorId: principal.userId,
      confirmations,
      grants,
    };
    if (notBefore !== undefined) req.confirmationsNotBefore = notBefore;
    if (input.exceptionReason !== undefined) req.exceptionReason = input.exceptionReason;
    if (input.policy !== undefined) req.policy = input.policy;
    const outcome = evaluateFinalization(req);

    const now = ctx.clock.now();
    const next: Work = {
      ...work,
      lifecycle: "finalized",
      finalRevisionId: outcome.revision.id,
      version: work.version + 1,
    };
    await ctx.works.update(next);
    const event: ApprovalEvent = {
      workId: work.id,
      revisionId: outcome.revision.id,
      actorId: principal.userId,
      action: outcome.usedException ? "exception_finalized" : "finalized",
      requiredChecksSnapshot: outcome.requiredChecksSnapshot,
      createdAt: now,
    };
    if (outcome.usedException && input.exceptionReason !== undefined)
      event.exceptionReason = input.exceptionReason;
    const openBot = threads.filter(
      (t) =>
        t.origin?.kind === "bot" && (t.resolution === "open" || t.resolution === "acknowledged"),
    ).length;
    if (openBot > 0)
      event.reason = `自動校正の未確認のコメント ${openBot} 件を残して校了${
        input.autoProofreadNote?.trim() ? `: ${input.autoProofreadNote.trim().slice(0, 500)}` : ""
      }`;
    await ctx.approvals.append(event);
    await ctx.audit.record({
      entityType: "work",
      entityId: work.id,
      operation: event.action,
      actorId: principal.userId,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      before: { lifecycle: work.lifecycle },
      after: { lifecycle: "finalized", finalRevisionId: outcome.revision.id },
      at: now,
    });
    const reviewers = (await ctx.assignments.listByRevision(outcome.revision.id)).map(
      (a) => a.reviewerId,
    );
    const who = (await personName(ctx, principal.userId)) ?? "校了権限者";
    const exception = event.action === "exception_finalized";
    await notify(ctx, [...workStakeholders(work), ...reviewers], principal.userId, {
      kind: "work_finalized",
      title: exception ? "制作物が例外校了しました" : "制作物が校了しました",
      body: `「${work.title}」${revisionLabel(outcome.revision)}を${who}が${exception ? "例外校了" : "校了"}しました${
        exception && event.exceptionReason ? `（理由: ${excerpt(event.exceptionReason, 80)}）` : ""
      }`,
      workId: work.id,
      revisionId: outcome.revision.id,
    });
    return { work: next, event };
  });
}

/** 理由付き再開（A-09）。過去の校了イベントは消さず、再開イベントを追記する。 */
export async function reopenWork(
  ctx: AppContext,
  principal: Principal,
  input: { workId: string; reason: string; expectedVersion?: number },
): Promise<FinalizeOutcome> {
  const { work } = await loadAuthorizedWork(ctx, principal, input.workId, "work.reopen");
  assertExpectedVersion(work, input.expectedVersion);
  if (work.lifecycle !== "finalized")
    throw new DomainError("work_not_finalized", { workId: work.id });
  const reason = assertReopenReason(input.reason);
  const now = ctx.clock.now();
  const next: Work = { ...work, lifecycle: "active", version: work.version + 1 };
  delete next.finalRevisionId;
  await ctx.works.update(next);
  const event: ApprovalEvent = {
    workId: work.id,
    revisionId: work.finalRevisionId ?? "",
    actorId: principal.userId,
    action: "reopened",
    requiredChecksSnapshot: {},
    reason,
    createdAt: now,
  };
  await ctx.approvals.append(event);
  await ctx.audit.record({
    entityType: "work",
    entityId: work.id,
    operation: "reopened",
    actorId: principal.userId,
    before: { finalRevisionId: work.finalRevisionId },
    after: { lifecycle: "active" },
    at: now,
  });
  const who = (await personName(ctx, principal.userId)) ?? "校了権限者";
  await notify(ctx, workStakeholders(work), principal.userId, {
    kind: "work_reopened",
    title: "校了が解除されました",
    body: `「${work.title}」を${who}が再開しました（理由: ${excerpt(reason, 80)}）`,
    workId: work.id,
  });
  return { work: next, event };
}

/** 最後に再開した時刻（再開より前の独立確認は数えない） */
function lastReopenedAt(events: readonly ApprovalEvent[]): number | undefined {
  let at: number | undefined;
  for (const e of events)
    if (e.action === "reopened" && (at === undefined || e.createdAt > at)) at = e.createdAt;
  return at;
}

export interface ConfirmIndependentlyInput {
  revisionId: string;
  note?: string;
  policy?: ApprovalPolicy;
}

/**
 * 独立確認を記録する（D2）。制作者・校了権限者以外の、制作物の確認に参加できる人が、
 * 自分の認証済みの操作で「この版を確認した」と残す。校了はこの記録がある版に対してだけ通る。
 * 同じ人が同じ版を確認し直しても、記録は 1 件のまま（最初の記録を返す）。
 */
export async function confirmIndependently(
  ctx: AppContext,
  principal: Principal,
  input: ConfirmIndependentlyInput,
): Promise<ApprovalConfirmation> {
  const revision = await ctx.revisions.findById(input.revisionId);
  if (!revision) throw new DomainError("forbidden", { revisionId: input.revisionId });
  const { work } = await loadAuthorizedWork(ctx, principal, revision.workId, "approval.confirm");
  const req: Parameters<typeof evaluateIndependentConfirmation>[0] = {
    work,
    revisions: await ctx.revisions.listByWork(work.id),
    revisionId: revision.id,
    confirmerId: principal.userId,
  };
  if (input.policy !== undefined) req.policy = input.policy;
  evaluateIndependentConfirmation(req);

  const notBefore = lastReopenedAt(await ctx.approvals.listByWork(work.id));
  const existing = (await ctx.approvals.listConfirmationsByRevision(revision.id)).find(
    (c) =>
      c.confirmerId === principal.userId && (notBefore === undefined || c.confirmedAt >= notBefore),
  );
  if (existing) return existing;

  const now = ctx.clock.now();
  const data: Omit<ApprovalConfirmation, "id"> = {
    workId: work.id,
    revisionId: revision.id,
    confirmerId: principal.userId,
    confirmedAt: now,
  };
  const note = normalizeConfirmationNote(input.note);
  if (note !== undefined) data.note = note;
  const confirmation = await ctx.approvals.insertConfirmation(data);
  await ctx.audit.record({
    entityType: "work",
    entityId: work.id,
    operation: "independent_confirmation",
    actorId: principal.userId,
    after: { revisionId: revision.id, confirmationId: confirmation.id },
    at: now,
  });
  return confirmation;
}

export interface ConfirmationStatus {
  /** 自己校了のため、校了の前に独立確認が要るか */
  required: boolean;
  /** 校了候補の版（最新の通常版）。無ければ null */
  candidateRevisionId: string | null;
  /** 校了候補の版で、いま有効な独立確認（無ければ null） */
  valid: ApprovalConfirmation | null;
  /** 閲覧している人が独立確認をできるか（ボタンを出すか） */
  canConfirm: boolean;
  /** 閲覧している人が、この版をもう確認したか */
  confirmedByMe: boolean;
}

/**
 * 独立確認の状況（校了ダイアログと「情報」に出す）。判定はドメインの関数をそのまま使い、画面で規則を持たない。
 */
export async function getConfirmationStatus(
  ctx: AppContext,
  principal: Principal,
  input: { workId: string; policy?: ApprovalPolicy },
): Promise<ConfirmationStatus> {
  const { work, grants } = await loadAuthorizedWork(ctx, principal, input.workId, "work.view");
  const policy = input.policy;
  const required = work.lifecycle === "active" && requiresIndependentConfirmation(work, policy);
  const candidate = latestStandardRevision(await ctx.revisions.listByWork(work.id));
  if (!required || !candidate)
    return {
      required,
      candidateRevisionId: candidate?.id ?? null,
      valid: null,
      canConfirm: false,
      confirmedByMe: false,
    };
  const notBefore = lastReopenedAt(await ctx.approvals.listByWork(work.id));
  const confirmations = await ctx.approvals.listConfirmationsByRevision(candidate.id);
  const validity = {
    work,
    revisionId: candidate.id,
    grants,
    actorId: work.approverId,
    ...(notBefore !== undefined ? { notBefore } : {}),
  };
  const valid = findValidConfirmation(confirmations, validity);
  const confirmedByMe = confirmations.some(
    (c) =>
      c.confirmerId === principal.userId && (notBefore === undefined || c.confirmedAt >= notBefore),
  );
  const canConfirm =
    !confirmedByMe &&
    isIndependentOf(work, principal.userId) &&
    isAllowed("approval.confirm", { work, grants, principal });
  return { required, candidateRevisionId: candidate.id, valid, canConfirm, confirmedByMe };
}
