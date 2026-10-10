import { addRequiredCheck, completeRequiredCheck, waiveRequiredCheck } from "@mf100/application";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { createAppContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { vCheckType } from "./lib/validators.ts";

/** 専門確認（必須チェック）の追加（§2.2-4 / D6）。校正者割当権限者。 */
export const add = mutation({
  args: {
    revisionId: v.id("revisions"),
    type: vCheckType,
    label: v.optional(v.string()),
    assigneeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const c = await addRequiredCheck(createAppContext(ctx.db), principal, args);
      return c.id;
    });
  },
});

/** 確認完了。担当者本人、または主管・校了権限者の代行。 */
export const complete = mutation({
  args: { checkId: v.id("requiredChecks"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const c = await completeRequiredCheck(createAppContext(ctx.db), principal, args);
      return c.state;
    });
  },
});

/** 免除（理由必須・監査対象）。主管・校了権限者。 */
export const waive = mutation({
  args: { checkId: v.id("requiredChecks"), reason: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const c = await waiveRequiredCheck(createAppContext(ctx.db), principal, args);
      return c.state;
    });
  },
});
