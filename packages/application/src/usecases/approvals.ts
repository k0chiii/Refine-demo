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
import { notify, workStakeholders } from "./notifications.ts";

export interface FinalizeWorkInput {
  workId: string;
  revisionId: string;
  exceptionReason?: string;
  independentConfirmerId?: string;
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
  const { work } = await loadAuthorizedWork(ctx, principal, input.workId, "work.finalize");
  return idempotent(ctx, `finalizeWork:${work.id}`, input.requestId, async () => {
    assertExpectedVersion(work, input.expectedVersion);
    const revisions = await ctx.revisions.listByWork(work.id);
    const threads = await ctx.threads.listByRevision(input.revisionId);
    const checks = await ctx.checks.listByRevision(input.revisionId);
    const req: Parameters<typeof evaluateFinalization>[0] = {
      work,
      revisionId: input.revisionId,
      revisions,
      threads,
      checks,
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
    const openBot = threads.filter(
      (t) =>
        t.origin?.kind === "bot" && (t.resolution === "open" || t.resolution === "acknowledged"),
    ).length;
    if (openBot > 0)
      event.reason = `自動校正の未確認の指摘 ${openBot} 件を残して校了${
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
    await notify(ctx, [...workStakeholders(work), ...reviewers], principal.userId, {
      kind: "work_finalized",
      title: `校了: ${work.title}`,
      body: `${event.action === "exception_finalized" ? "例外校了（理由付き）" : "校了"}が宣言されました。`,
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
  await notify(ctx, workStakeholders(work), principal.userId, {
    kind: "work_reopened",
    title: `校了を解除して再開: ${work.title}`,
    body: `理由: ${reason}`,
    workId: work.id,
  });
  return { work: next, event };
}
