import { closeByDeadline, DomainError, markResponded, markViewed, type Principal, type ReviewAssignment, type Revision } from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";

/** 校正者の割当（F-05）。割当は review 権限の ACL を自動で意味しない。閲覧権限は管理者が ACL で付与する（D3）。 */
export async function assignReviewers(
  ctx: AppContext,
  principal: Principal,
  input: { revisionId: string; reviewerIds: string[]; reviewType: string },
): Promise<ReviewAssignment[]> {
  const revision = await ctx.revisions.findById(input.revisionId);
  if (!revision) throw new DomainError("forbidden", { revisionId: input.revisionId });
  await loadAuthorizedWork(ctx, principal, revision.workId, "review.assign");
  const out: ReviewAssignment[] = [];
  for (const reviewerId of new Set(input.reviewerIds)) {
    const existing = await ctx.assignments.find(revision.id, reviewerId);
    if (existing) {
      out.push(existing);
      continue;
    }
    const a: ReviewAssignment = { revisionId: revision.id, reviewerId, reviewType: input.reviewType, state: "pending" };
    await ctx.assignments.upsert(a);
    out.push(a);
  }
  await ctx.audit.record({ entityType: "reviewAssignment", entityId: revision.id, operation: "assign", actorId: principal.userId, after: input.reviewerIds, at: ctx.clock.now() });
  return out;
}

/** 校正者が版を開いたとき。pending → viewed のみ。responded には自動遷移しない。 */
export async function markRevisionViewed(ctx: AppContext, principal: Principal, revisionId: string): Promise<void> {
  const a = await ctx.assignments.find(revisionId, principal.userId);
  if (!a) return;
  const next = markViewed(a, ctx.clock.now());
  if (next !== a) await ctx.assignments.upsert(next);
}

/** 校正者が「自分の確認を完了」と明示したとき（A-06: コメント投稿では遷移しない）。 */
export async function completeMyReview(ctx: AppContext, principal: Principal, revisionId: string): Promise<ReviewAssignment> {
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
    await ctx.audit.record({ entityType: "revision", entityId: r.id, operation: "review_closed:deadline", actorId: "system", at: now });
    closed.push(next);
  }
  return closed;
}
