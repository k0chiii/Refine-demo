import { loadAuthorizedWork, syncPlanInfoWarnings } from "@mf100/application";
import { checkRegisteredPlanInfoInText, heuristicPlanInfoCompare } from "@mf100/domain";
import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { principalOf, requireUser } from "./lib/principal.ts";

/** 企画情報と版本文の照合（warn-only bot スレッド。decision 71B） */
export const check = mutation({
  args: { workId: v.string(), text: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
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
    return runUseCase(() => syncPlanInfoWarnings(createAppContext(ctx), principal, args.workId));
  },
});

/** 登録情報と本文の項目照合（decision 70A）。AI は heuristicPlanInfoCompare スタブ */
export const compare = mutation({
  args: {
    workId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    const app = createReadContext(ctx.db);
    const { work } = await loadAuthorizedWork(app, principal, args.workId, "work.view");
    const info = work.registeredPlanInfo;
    if (!info) return { items: [] as const };
    const items = await heuristicPlanInfoCompare.compare(args.text, info);
    await runUseCase(() =>
      syncPlanInfoWarnings(createAppContext(ctx), principal, args.workId, {
        textOverride: args.text,
      }),
    );
    return { items };
  },
});
