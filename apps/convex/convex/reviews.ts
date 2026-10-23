import { assignReviewers, completeMyReview } from "@mf100/application";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { createAppContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

export const assign = mutation({
  args: { revisionId: v.id("revisions"), reviewerIds: v.array(v.string()), reviewType: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const out = await assignReviewers(createAppContext(ctx), principal, args);
      return out.length;
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
