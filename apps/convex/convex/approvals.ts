import { finalizeWork, reopenWork } from "@mf100/application";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { createAppContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/** 校了宣言（U-07 / A-08 / A-10）。ガードはすべてドメイン側で評価する。 */
export const finalize = mutation({
  args: {
    workId: v.id("works"),
    revisionId: v.id("revisions"),
    exceptionReason: v.optional(v.string()),
    independentConfirmerId: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const { event } = await finalizeWork(createAppContext(ctx.db), principal, args);
      return { action: event.action, createdAt: event.createdAt };
    });
  },
});

/** 理由付き再開（A-09）。 */
export const reopen = mutation({
  args: { workId: v.id("works"), reason: v.string(), expectedVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const { event } = await reopenWork(createAppContext(ctx.db), principal, args);
      return { action: event.action, createdAt: event.createdAt };
    });
  },
});
