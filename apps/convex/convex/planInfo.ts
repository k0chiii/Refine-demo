import { loadAuthorizedWork, syncPlanInfoWarnings } from "@mf100/application";
import { checkRegisteredPlanInfoInText } from "@mf100/domain";
import { v } from "convex/values";
import { action, internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { principalOf, requireUser } from "./lib/principal.ts";

/** 企画情報と版本文の照合（warn-only bot スレッド。decision 71B） */
export const check = action({
  args: { workId: v.string(), text: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { principal, user } = await requireUser(ctx);
    return await ctx.runMutation(internal.planInfo.applyCheck, {
      workId: args.workId,
      userId: user._id,
      ...(args.text !== undefined ? { text: args.text } : {}),
    });
  },
});

export const applyCheck = internalMutation({
  args: { workId: v.string(), userId: v.id("users"), text: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { created: 0, skipped: "no_user" };
    const principal = principalOf(user);
    return runUseCase(() =>
      syncPlanInfoWarnings(createAppContext(ctx), principal, args.workId, {
        ...(args.text !== undefined ? { textOverride: args.text } : {}),
      }),
    );
  },
});

/** 制作物更新後の自動再照合（decision 72） */
export const sync = internalMutation({
  args: { workId: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { created: 0, skipped: "no_user" };
    const principal = principalOf(user);
    return runUseCase(() =>
      syncPlanInfoWarnings(createAppContext(ctx), principal, args.workId),
    );
  },
});

/** 登録情報と本文の項目照合（decision 70A）。不一致は warn スレッドを作る */
export const compare = mutation({
  args: {
    workId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const { principal, user } = await requireUser(ctx);
    const app = createReadContext(ctx.db);
    const { work } = await loadAuthorizedWork(app, principal, args.workId, "work.view");
    const info = work.registeredPlanInfo;
    if (!info) return { items: [] as const };
    const items = checkRegisteredPlanInfoInText(args.text, info);
    await runUseCase(() =>
      syncPlanInfoWarnings(createAppContext(ctx), principal, args.workId, {
        textOverride: args.text,
      }),
    );
    void user;
    return { items };
  },
});
