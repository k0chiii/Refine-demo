import { closeExpiredReviews, loadAuthorizedWork, markRevisionViewed } from "@mf100/application";
import { DomainError, isAccepting, isAllowed, revisionLabel } from "@mf100/domain";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { resolveUsers } from "./lib/users.ts";

/**
 * 校正ワークスペース（U-05 / U-06）のデータ。版・添付・スレッド・割当・操作可否を一度に返す。
 * 権限が無ければ版の存在も返さない。
 */
export const get = query({
  args: { revisionId: v.string() },
  handler: async (ctx, { revisionId }) => {
    const { principal } = await requireUser(ctx);
    const app = createReadContext(ctx.db);
    return runUseCase(async () => {
      const revision = await app.revisions.findById(revisionId);
      if (!revision) throw new DomainError("forbidden", { revisionId });
      const { work, grants } = await loadAuthorizedWork(
        app,
        principal,
        revision.workId,
        "work.view",
      );
      const authz = { work, grants, principal };
      const siblings = await app.revisions.listByWork(work.id);
      const accepting = siblings.find(isAccepting) ?? null;
      const now = Date.now();
      const artifacts = await app.artifacts.listByRevision(revision.id);
      const threads = await app.threads.listByRevision(revision.id);
      const assignments = await app.assignments.listByRevision(revision.id);
      const users = await resolveUsers(ctx.db, [
        ...threads.map((t) => t.authorId),
        ...assignments.map((a) => a.reviewerId),
        revision.submittedBy,
      ]);
      const myAssignment = assignments.find((a) => a.reviewerId === principal.userId) ?? null;
      const canPostNow =
        isAllowed("comment.post", authz) &&
        work.lifecycle !== "finalized" &&
        accepting?.id === revision.id &&
        now < revision.deadlineAt;
      return {
        revision: {
          ...revision,
          label: revisionLabel(revision),
          submitter: users.get(revision.submittedBy),
        },
        work: {
          id: work.id,
          title: work.title,
          lifecycle: work.lifecycle,
          mediaType: work.mediaType,
          finalRevisionId: work.finalRevisionId ?? null,
        },
        artifacts,
        threads: threads
          .map((t) => ({ ...t, author: users.get(t.authorId) }))
          .sort((a, b) => a.createdAt - b.createdAt),
        assignments: assignments.map((a) => ({ ...a, reviewer: users.get(a.reviewerId) })),
        myAssignment,
        acceptingRevisionId: accepting?.id ?? null,
        can: {
          comment: canPostNow,
          decide: isAllowed("comment.decide", authz) && work.lifecycle !== "finalized",
          assign: isAllowed("review.assign", authz),
          completeReview:
            myAssignment !== null &&
            myAssignment.state !== "responded" &&
            myAssignment.state !== "excused",
        },
        /** UI が「なぜ投稿できないか」を説明するための理由 */
        commentBlockedReason: canPostNow
          ? null
          : work.lifecycle === "finalized"
            ? "finalized"
            : revision.reviewState !== "open"
              ? (revision.reviewClosedReason ?? "closed")
              : now >= revision.deadlineAt
                ? "deadline"
                : accepting?.id !== revision.id
                  ? "not_latest"
                  : "forbidden",
      };
    });
  },
});

/** 校正者が版を開いた（pending → viewed）。 */
export const markViewed = mutation({
  args: { revisionId: v.id("revisions") },
  handler: async (ctx, { revisionId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const app = createAppContext(ctx.db);
      const revision = await app.revisions.findById(revisionId);
      if (!revision) throw new DomainError("forbidden", { revisionId });
      await loadAuthorizedWork(app, principal, revision.workId, "work.view");
      await markRevisionViewed(app, principal, revisionId);
      return null;
    });
  },
});

/** cron から呼ばれる期限到来ジョブ（A-05）。 */
export const closeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const closed = await closeExpiredReviews(createAppContext(ctx.db), 200);
    return closed.length;
  },
});
