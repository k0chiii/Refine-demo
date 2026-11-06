import { completeMyReview, setWorkReviewers } from "@mf100/application";
import { z } from "zod";
import { mutation, type FnDef } from "./define.ts";
import { object, vId } from "./validators.ts";

// apps/convex/convex/reviews.ts の写し（myQueue は割当を読む画面向けの読みで別の単位）

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
} satisfies Record<string, FnDef>;
