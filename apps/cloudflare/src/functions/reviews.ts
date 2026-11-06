import { completeMyReview, setWorkReviewers } from "@mf100/application";
import {
  isApproverOf,
  isBeforeDeadline,
  isDeadlineReached,
  overridesAllPermissions,
  revisionLabel,
} from "@mf100/domain";
import type { ReviewAssignment } from "@mf100/domain";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object, vId } from "./validators.ts";

// apps/convex/convex/reviews.ts の写し

export const reviews = {
  "reviews:setReviewers": mutation({
    auth: "user",
    args: object({ workId: vId, reviewerIds: z.array(vId) }),
    handler: async (ctx, args) => {
      await setWorkReviewers(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /** 校正者が「確認完了」を明示する（A-06） */
  "reviews:complete": mutation({
    auth: "user",
    args: object({ revisionId: vId }),
    handler: async (ctx, { revisionId }) => {
      const a = await completeMyReview(ctx.db, ctx.principal!, revisionId);
      return a.state;
    },
  }),

  /**
   * 自分の校正待ち（U-01 / F-05）。割当のある版を締切順に返す。
   * 未読（pending）/確認済（viewed, responded）/指摘有/期限超過を区別できる情報を付ける。
   * 割当があっても ACL / 職責が無い制作物は出さない（割当 ≠ 閲覧権限、D3。Convex と同じく、グループへの許可は数えない）
   */
  "reviews:myQueue": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => {
      const principal = ctx.principal!;
      const now = ctx.now();
      // 状態の順（pending → viewed → responded）に並べる。同じ締切の行はこの順のまま（Convex と同じ）
      const assignments = (["pending", "viewed", "responded"] as const).flatMap((state) =>
        ctx.sql
          .exec(
            "SELECT doc FROM assignments WHERE reviewerId = ? AND json_extract(doc, '$.state') = ? ORDER BY rowid",
            principal.userId,
            state,
          )
          .map((r) => JSON.parse(r.doc as string) as ReviewAssignment),
      );
      const items = [];
      for (const a of assignments) {
        const revision = await ctx.db.revisions.findById(a.revisionId);
        if (!revision) continue;
        const work = await ctx.db.works.findById(revision.workId);
        if (!work) continue;
        const grants = await ctx.db.acl.listByWork(work.id);
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
        const myThreads = await ctx.db.threads.listByRevision(revision.id);
        items.push({
          revisionId: revision.id,
          workId: work.id,
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
      return items.sort(
        (a, b) => Number(b.isOpen) - Number(a.isOpen) || a.deadlineAt - b.deadlineAt,
      );
    },
  }),
} satisfies Record<string, FnDef>;
