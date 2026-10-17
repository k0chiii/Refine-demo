import {
  revisionLabel,
  checkTypeLabels,
  completeCheck,
  DomainError,
  isAllowed,
  type CheckType,
  type Principal,
  type RequiredCheck,
  waiveCheck,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";
import { about, notify, personName, workStakeholders } from "./notifications.ts";

/**
 * 専門確認（必須チェック）（§2.2-4 / C3 / D6）。
 * - 宣言は版の提出時（prepareSubmission の requiredChecks）または主管・制作者が後から追加。
 * - 完了は担当者本人、または主管・校了権限者（代行）。免除は主管・校了権限者のみ、理由必須。
 */
export async function addRequiredCheck(
  ctx: AppContext,
  principal: Principal,
  input: { revisionId: string; type: CheckType; label?: string; assigneeId?: string },
): Promise<RequiredCheck> {
  const revision = await ctx.revisions.findById(input.revisionId);
  if (!revision) throw new DomainError("forbidden", { revisionId: input.revisionId });
  const { work } = await loadAuthorizedWork(ctx, principal, revision.workId, "review.assign");
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  const data: Omit<RequiredCheck, "id"> = {
    revisionId: revision.id,
    type: input.type,
    label: input.label?.trim() || checkTypeLabels[input.type],
    state: "pending",
  };
  if (input.assigneeId) data.assigneeId = input.assigneeId;
  const check = await ctx.checks.insert(data);
  await ctx.audit.record({
    entityType: "requiredCheck",
    entityId: check.id,
    operation: "add",
    actorId: principal.userId,
    after: check,
    at: ctx.clock.now(),
  });
  if (check.assigneeId) {
    const who = await personName(ctx, principal.userId);
    await notify(ctx, [check.assigneeId], principal.userId, {
      kind: "check_requested",
      title: "専門確認を依頼されました",
      body: `${about(work.title, revisionLabel(revision), who ? `${who}から` : null)}: ${check.label}`,
      workId: work.id,
      revisionId: revision.id,
    });
  }
  return check;
}

async function loadCheck(ctx: AppContext, principal: Principal, checkId: string) {
  const check = await ctx.checks.findById(checkId);
  if (!check) throw new DomainError("check_not_found", { checkId });
  const revision = await ctx.revisions.findById(check.revisionId);
  if (!revision) throw new DomainError("check_not_found", { checkId });
  const { work, grants } = await loadAuthorizedWork(ctx, principal, revision.workId, "work.view");
  return { check, revision, work, grants };
}

export async function completeRequiredCheck(
  ctx: AppContext,
  principal: Principal,
  input: { checkId: string; note?: string },
): Promise<RequiredCheck> {
  const { check, revision, work, grants } = await loadCheck(ctx, principal, input.checkId);
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  const canActForAnyone =
    isAllowed("work.edit", { work, grants, principal }) ||
    isAllowed("work.finalize", { work, grants, principal });
  const next = completeCheck(check, principal.userId, canActForAnyone, ctx.clock.now(), input.note);
  await ctx.checks.update(next);
  await ctx.audit.record({
    entityType: "requiredCheck",
    entityId: check.id,
    operation: "complete",
    actorId: principal.userId,
    before: check.state,
    after: next.state,
    at: ctx.clock.now(),
  });
  const who = await personName(ctx, principal.userId);
  await notify(ctx, workStakeholders(work), principal.userId, {
    kind: "check_completed",
    title: "専門確認が完了しました",
    body: `${about(work.title, revisionLabel(revision), who)}が「${check.label}」を完了しました`,
    workId: work.id,
    revisionId: revision.id,
  });
  return next;
}

export async function waiveRequiredCheck(
  ctx: AppContext,
  principal: Principal,
  input: { checkId: string; reason: string },
): Promise<RequiredCheck> {
  const { check, work, grants } = await loadCheck(ctx, principal, input.checkId);
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  if (
    !isAllowed("work.edit", { work, grants, principal }) &&
    !isAllowed("work.finalize", { work, grants, principal })
  ) {
    throw new DomainError("forbidden", { action: "check.waive" });
  }
  const next = waiveCheck(check, principal.userId, input.reason, ctx.clock.now());
  await ctx.checks.update(next);
  await ctx.audit.record({
    entityType: "requiredCheck",
    entityId: check.id,
    operation: "waive",
    actorId: principal.userId,
    after: { reason: input.reason },
    at: ctx.clock.now(),
  });
  return next;
}
