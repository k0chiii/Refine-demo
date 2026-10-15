import {
  closeByDeadline,
  DomainError,
  formatDeadlineUntil,
  hasOrgPermission,
  isAllowed,
  isDeadlineReached,
  markResponded,
  markViewed,
  orgPermissions,
  type Principal,
  type ReviewAssignment,
  type Revision,
  revisionLabel,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";
import { notify } from "./notifications.ts";

/**
 * 校正者の割当（F-05）。割当できる人は Nogiku の組織権限 `reviews:assign`、または作品の制作者・edit 委任者
 * （利用者決定: Nogiku の役職・個人で管理）。割当は review 権限の ACL を自動で意味しない。閲覧権限は管理者が ACL で付与する（D3）。
 */
export async function assignReviewers(
  ctx: AppContext,
  principal: Principal,
  input: { revisionId: string; reviewerIds: string[]; reviewType: string },
): Promise<ReviewAssignment[]> {
  const revision = await ctx.revisions.findById(input.revisionId);
  if (!revision) throw new DomainError("forbidden", { revisionId: input.revisionId });
  const { work, grants } = await loadAuthorizedWork(ctx, principal, revision.workId, "work.view");
  const byRole = isAllowed("review.assign", { work, grants, principal });
  if (!byRole && !hasOrgPermission(principal, orgPermissions.reviewsAssign)) {
    throw new DomainError("forbidden", { action: "review.assign" });
  }
  const out: ReviewAssignment[] = [];
  const newlyAssigned: string[] = [];
  for (const reviewerId of new Set(input.reviewerIds)) {
    const existing = await ctx.assignments.find(revision.id, reviewerId);
    if (existing) {
      out.push(existing);
      continue;
    }
    newlyAssigned.push(reviewerId);
    const a: ReviewAssignment = {
      revisionId: revision.id,
      reviewerId,
      reviewType: input.reviewType,
      state: "pending",
    };
    await ctx.assignments.upsert(a);
    out.push(a);
  }
  await ctx.audit.record({
    entityType: "reviewAssignment",
    entityId: revision.id,
    operation: "assign",
    actorId: principal.userId,
    after: input.reviewerIds,
    at: ctx.clock.now(),
  });
  await notify(ctx, newlyAssigned, principal.userId, {
    kind: "review_assigned",
    title: `校正の割当: ${work.title} ${revisionLabel(revision)}`,
    body: revision.focusNotes ? `見てほしい観点: ${revision.focusNotes}` : "校正をお願いします。",
    workId: work.id,
    revisionId: revision.id,
  });
  return out;
}

/**
 * 期限接近リマインド（F-11 / §10-3）: 受付中で期限が windowMs 以内、かつ未確認の割当に 1 回だけ通知する。
 * 同じ内容を何度も送らない（冪等キーで版×校正者につき 1 回）。
 * 判定は締切の時刻どうしの比較なので、日付だけの締切（その日の終わり＝翌日 0:00 JST）なら当日の 0:00 JST から届く。
 */
export async function remindUpcomingDeadlines(
  ctx: AppContext,
  windowMs = 24 * 3_600_000,
  limit = 500,
): Promise<number> {
  const now = ctx.clock.now();
  let sent = 0;
  for (const a of await ctx.assignments.listUnresponded(limit)) {
    const revision = await ctx.revisions.findById(a.revisionId);
    if (!revision || revision.reviewState !== "open") continue;
    if (isDeadlineReached(now, revision.deadlineAt) || revision.deadlineAt - now > windowMs)
      continue;
    const key = `${revision.id}:${a.reviewerId}`;
    if (await ctx.idempotency.get("deadlineReminder", key)) continue;
    const work = await ctx.works.findById(revision.workId);
    if (!work) continue;
    await notify(ctx, [a.reviewerId], null, {
      kind: "deadline_approaching",
      title: `校正期限が近づいています: ${work.title} ${revisionLabel(revision)}`,
      body: `締切は ${formatDeadlineUntil(revision.deadlineAt, now)}。未確認の校正があります。期限を過ぎると新規の指摘はできません。`,
      workId: work.id,
      revisionId: revision.id,
    });
    await ctx.idempotency.put("deadlineReminder", key, { sentAt: now });
    sent++;
  }
  return sent;
}

/** 校正者が版を開いたとき。pending → viewed のみ。responded には自動遷移しない。 */
export async function markRevisionViewed(
  ctx: AppContext,
  principal: Principal,
  revisionId: string,
): Promise<void> {
  const a = await ctx.assignments.find(revisionId, principal.userId);
  if (!a) return;
  const next = markViewed(a, ctx.clock.now());
  if (next !== a) await ctx.assignments.upsert(next);
}

/** 校正者が「自分の確認を完了」と明示したとき（A-06: コメント投稿では遷移しない）。 */
export async function completeMyReview(
  ctx: AppContext,
  principal: Principal,
  revisionId: string,
): Promise<ReviewAssignment> {
  const a = await ctx.assignments.find(revisionId, principal.userId);
  if (!a) throw new DomainError("forbidden", { revisionId });
  const next = markResponded(a, ctx.clock.now());
  await ctx.assignments.upsert(next);
  return next;
}

/**
 * 期限到来による受付終了ジョブ（F-08 / A-05）。
 * 受付だけを閉じる。未読・指摘・校了状態は変更しない。
 * このジョブが遅延しても assertCanPostComment が時刻比較で新規指摘を拒否する。
 */
export async function closeExpiredReviews(ctx: AppContext, limit = 100): Promise<Revision[]> {
  const now = ctx.clock.now();
  const closed: Revision[] = [];
  for (const r of await ctx.revisions.listOpenExpired(now, limit)) {
    const next = closeByDeadline(r, now);
    if (next === r) continue;
    await ctx.revisions.update(next);
    await ctx.audit.record({
      entityType: "revision",
      entityId: r.id,
      operation: "review_closed:deadline",
      actorId: "system",
      at: now,
    });
    closed.push(next);
  }
  return closed;
}
