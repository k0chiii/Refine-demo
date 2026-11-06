import { completeMyReview, setWorkReviewers } from "@mf100/application";
import {
  isApproverOf,
  isBeforeDeadline,
  isDeadlineReached,
  overridesAllPermissions,
  revisionLabel,
} from "@mf100/domain";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

export const setReviewers = mutation({
  args: { workId: v.id("works"), reviewerIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await setWorkReviewers(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

/** 校正者が「確認完了」を明示する（A-06）。 */
export const complete = mutation({
  args: { revisionId: v.id("revisions") },
  handler: async (ctx, { revisionId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const a = await completeMyReview(createAppContext(ctx), principal, revisionId);
      return a.state;
    });
  },
});

/**
 * 自分の校正待ち（U-01 / F-05）。割当のある版を締切順に返す。
 * 未読（pending）/確認済（viewed, responded）/指摘有/期限超過を区別できる情報を付ける。
 */
export const myQueue = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    const now = Date.now();
    const assignments = [
      ...(await ctx.db
        .query("reviewAssignments")
        .withIndex("by_reviewer_state", (q) =>
          q.eq("reviewerId", principal.userId).eq("state", "pending"),
        )
        .collect()),
      ...(await ctx.db
        .query("reviewAssignments")
        .withIndex("by_reviewer_state", (q) =>
          q.eq("reviewerId", principal.userId).eq("state", "viewed"),
        )
        .collect()),
      ...(await ctx.db
        .query("reviewAssignments")
        .withIndex("by_reviewer_state", (q) =>
          q.eq("reviewerId", principal.userId).eq("state", "responded"),
        )
        .collect()),
    ];
    const items = [];
    for (const a of assignments) {
      const revision = await ctx.db.get("revisions", a.revisionId);
      if (!revision) continue;
      const work = await ctx.db.get("works", revision.workId);
      if (!work) continue;
      // 割当があっても ACL/職責が無い作品は出さない（割当 ≠ 閲覧権限、D3）
      const grants = await ctx.db
        .query("workPermissions")
        .withIndex("by_work", (q) => q.eq("workId", work._id))
        .collect();
      const hasAccess =
        overridesAllPermissions(principal) ||
        work.creatorIds.includes(principal.userId) ||
        work.managerIds.includes(principal.userId) ||
        isApproverOf(work, principal.userId) ||
        grants.some(
          (g) =>
            g.revokedAt === undefined &&
            g.principalType === "user" &&
            g.principalId === principal.userId,
        );
      if (!hasAccess) continue;
      const myThreads = await ctx.db
        .query("commentThreads")
        .withIndex("by_revision", (q) => q.eq("revisionId", revision._id))
        .collect()
        .then((rows) => rows.filter((t) => t.deletedAt === undefined));
      items.push({
        revisionId: revision._id,
        workId: work._id,
        workTitle: work.title,
        category: work.category,
        mediaType: work.mediaType,
        revisionLabel: revisionLabel(revision),
        kind: revision.kind,
        reviewType: a.reviewType,
        focusNotes: revision.focusNotes,
        deadlineAt: revision.deadlineAt,
        reviewUrgent: revision.reviewUrgent === true,
        reviewState: revision.reviewState,
        isOpen: revision.reviewState === "open" && isBeforeDeadline(now, revision.deadlineAt),
        overdue: revision.reviewState !== "open" || isDeadlineReached(now, revision.deadlineAt),
        assignmentState: a.state,
        myCommentCount: myThreads.filter((t) => t.authorId === principal.userId).length,
        totalCommentCount: myThreads.length,
      });
    }
    return items.sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || a.deadlineAt - b.deadlineAt);
  },
});
