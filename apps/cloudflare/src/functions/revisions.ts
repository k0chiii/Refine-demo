import {
  acceptingRevisionIdOf,
  listCommentFileViews,
  loadAuthorizedWork,
  markRevisionViewed,
  presentThreadActivity,
} from "@mf100/application";
import {
  DomainError,
  isAllowed,
  isBeforeDeadline,
  isDeadlineReached,
  isUnresponded,
  presentThread,
  revisionLabel,
} from "@mf100/domain";
import { mutation, query, type FnDef } from "./define.ts";
import {
  activityOf,
  loadGroupNames,
  mentionViews,
  reactionViews,
  reactorIds,
} from "./threadView.ts";
import { resolveUsers } from "./users.ts";
import { object, vId } from "./validators.ts";
import { z } from "zod";

// apps/convex/convex/revisions.ts の写し（closeExpired / remindDeadlines は cron で db.ts の runJobs が持つ）

export const revisions = {
  /**
   * 校正ワークスペース（U-05 / U-06）のデータ。版・添付・スレッド・割当・操作可否を一度に返す。
   * 権限が無ければ版の存在も返さない
   */
  "revisions:get": query({
    auth: "user",
    args: object({ revisionId: z.string() }),
    handler: async (ctx, { revisionId }) => {
      const principal = ctx.principal!;
      const revision = await ctx.db.revisions.findById(revisionId);
      if (!revision) throw new DomainError("forbidden", { revisionId });
      const { work, grants } = await loadAuthorizedWork(
        ctx.db,
        principal,
        revision.workId,
        "work.view",
      );
      const authz = { work, grants, principal };
      // 受付中の版（制作物の全ての版は読まない。要約が無い古い制作物だけ版から探す）
      const acceptingId = await acceptingRevisionIdOf(ctx.db, revision);
      const now = ctx.now();
      const artifacts = await ctx.db.artifacts.listByRevision(revision.id);
      // 削除されたコメントは出さない（listByRevision は削除済みを含めない）
      const stored = await ctx.db.threads.listByRevision(revision.id);
      const threads = stored.map((t) =>
        presentThread(t, principal.userId, work.lifecycle, principal),
      );
      // 返信の件数・参加者・最後の動きと、自分にとっての未読（スレッドごと）
      const activity = await presentThreadActivity(ctx.db, principal, stored);
      const assignments = await ctx.db.assignments.listByRevision(revision.id);
      const checks = await ctx.db.checks.listByRevision(revision.id);
      const users = resolveUsers(ctx.sql, [
        ...threads.map((t) => t.authorId),
        ...threads.flatMap((t) => (t.assigneeId ? [t.assigneeId] : [])),
        ...threads.flatMap((t) => t.mentions ?? []),
        ...threads.flatMap((t) => reactorIds(t.reactions)),
        ...[...activity.values()].flatMap((a) => a.participantIds),
        ...[...activity.values()].flatMap((a) =>
          a.latestReplies.flatMap((r) => [r.authorId, ...r.mentionIds]),
        ),
        ...assignments.map((a) => a.reviewerId),
        ...checks.flatMap((c) => [
          ...(c.assigneeId ? [c.assigneeId] : []),
          ...(c.doneBy ? [c.doneBy] : []),
        ]),
        revision.submittedBy,
      ]);
      const groupNames = await loadGroupNames(ctx.db, [
        ...threads.flatMap((t) => t.mentionGroupIds ?? []),
        ...[...activity.values()].flatMap((a) => a.latestReplies.flatMap((r) => r.mentionGroupIds)),
      ]);
      const myAssignment = assignments.find((a) => a.reviewerId === principal.userId) ?? null;
      const canManageChecks = isAllowed("work.edit", authz) || isAllowed("work.finalize", authz);
      const canPostNow =
        isAllowed("comment.post", authz) &&
        work.lifecycle !== "finalized" &&
        acceptingId === revision.id &&
        isBeforeDeadline(now, revision.deadlineAt);
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
          /** 添付を端末に残してよいかの判断に使う（web の fileCachePolicy）。認可には使わない */
          finalRevisionId: work.finalRevisionId ?? null,
        },
        artifacts,
        threads: (
          await Promise.all(
            threads.map(async (t) => ({
              ...t,
              ...activityOf(activity, t.id, users, groupNames),
              author: users.get(t.authorId),
              assignee: t.assigneeId ? users.get(t.assigneeId) : null,
              reactions: reactionViews(t.reactions, principal.userId, users),
              mentionUsers: mentionViews(t.mentions ?? [], t.mentionGroupIds, users, groupNames),
              /** 添付（検証済みで削除されていないもの。付けた順） */
              files: await listCommentFileViews(ctx.db, t.fileIds),
            })),
          )
        ).sort((a, b) => a.createdAt - b.createdAt),
        assignments: assignments.map((a) => ({ ...a, reviewer: users.get(a.reviewerId) })),
        checks: checks.map((c) => ({
          ...c,
          assignee: c.assigneeId ? users.get(c.assigneeId) : null,
          doneByUser: c.doneBy ? users.get(c.doneBy) : null,
          canComplete:
            c.state === "pending" &&
            work.lifecycle !== "finalized" &&
            (c.assigneeId === principal.userId || canManageChecks),
          canWaive: c.state === "pending" && work.lifecycle !== "finalized" && canManageChecks,
        })),
        myAssignment,
        acceptingRevisionId: acceptingId,
        can: {
          comment: canPostNow,
          decide: isAllowed("comment.decide", authz) && work.lifecycle !== "finalized",
          // 採否を決められなくても、校了者は解決で閉じられる（develop の PR #298 と同じ）
          resolve: isAllowed("comment.resolve", authz) && work.lifecycle !== "finalized",
          reply: isAllowed("comment.reply", authz) && work.lifecycle !== "finalized",
          assign: isAllowed("review.assign", authz),
          addCheck: isAllowed("review.assign", authz) && work.lifecycle !== "finalized",
          void:
            isAllowed("revision.submit", authz) &&
            work.lifecycle !== "finalized" &&
            revision.reviewState === "open",
          carryForward:
            isAllowed("comment.decide", authz) &&
            work.lifecycle !== "finalized" &&
            acceptingId === revision.id,
          completeReview: myAssignment !== null && isUnresponded(myAssignment),
        },
        /** UI が「なぜ投稿できないか」を説明するための理由 */
        commentBlockedReason: canPostNow
          ? null
          : work.lifecycle === "finalized"
            ? "finalized"
            : revision.reviewState !== "open"
              ? (revision.reviewClosedReason ?? "closed")
              : isDeadlineReached(now, revision.deadlineAt)
                ? "deadline"
                : acceptingId !== revision.id
                  ? "not_latest"
                  : "forbidden",
      };
    },
  }),

  /** 校正者が版を開いた（pending → viewed） */
  "revisions:markViewed": mutation({
    auth: "user",
    args: object({ revisionId: vId }),
    handler: async (ctx, { revisionId }) => {
      const revision = await ctx.db.revisions.findById(revisionId);
      if (!revision) throw new DomainError("forbidden", { revisionId });
      await loadAuthorizedWork(ctx.db, ctx.principal!, revision.workId, "work.view");
      await markRevisionViewed(ctx.db, ctx.principal!, revisionId);
      return null;
    },
  }),
} satisfies Record<string, FnDef>;
