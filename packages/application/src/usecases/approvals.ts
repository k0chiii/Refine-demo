import {
  type ApprovalEvent,
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

export interface FinalizeWorkInput {
  workId: string;
  revisionId: string;
  exceptionReason?: string;
  independentConfirmerId?: string;
  expectedVersion?: number;
  requestId?: string;
  /** 制度承認後に差し替えるポリシー。未指定なら安全側の既定値。 */
  policy?: ApprovalPolicy;
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
  const { work } = await loadAuthorizedWork(ctx, principal, input.workId, "work.finalize");
  return idempotent(ctx, `finalizeWork:${work.id}`, input.requestId, async () => {
    assertExpectedVersion(work, input.expectedVersion);
    const revisions = await ctx.revisions.listByWork(work.id);
    const threads = await ctx.threads.listByRevision(input.revisionId);
    const req: Parameters<typeof evaluateFinalization>[0] = {
      work,
      revisionId: input.revisionId,
      revisions,
      threads,
      actorId: principal.userId,
    };
    if (input.exceptionReason !== undefined) req.exceptionReason = input.exceptionReason;
    if (input.independentConfirmerId !== undefined)
      req.independentConfirmerId = input.independentConfirmerId;
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
  return { work: next, event };
}
