import { exportWorkStats } from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createReadContext } from "./lib/adapters.ts";
import { runUseCase, unauthenticated } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/** 校正システム管理者の付与・剥奪。管理者のみ。自分自身の剥奪は最後の一人なら拒否する。 */
export const setSystemAdmin = mutation({
  args: { userId: v.id("users"), value: v.boolean() },
  handler: async (ctx, { userId, value }) => {
    const { principal } = await requireUser(ctx);
    if (!principal.isSystemAdmin) unauthenticated();
    if (!value && userId === principal.userId) {
      const admins = (await ctx.db.query("users").take(1000)).filter((u) => u.isSystemAdmin);
      if (admins.length <= 1) throw new Error("最後のシステム管理者は外せません");
    }
    const before = await ctx.db.get("users", userId);
    await ctx.db.patch("users", userId, { isSystemAdmin: value });
    await ctx.db.insert("auditEvents", {
      entityType: "user",
      entityId: userId,
      operation: value ? "grant_system_admin" : "revoke_system_admin",
      actorId: principal.userId,
      before: before?.isSystemAdmin ?? false,
      after: value,
      at: Date.now(),
    });
    return null;
  },
});

/** 監査ログ（F-13）。管理者のみ。 */
export const auditLog = query({
  args: {
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    if (!principal.isSystemAdmin) unauthenticated();
    const limit = Math.min(args.limit ?? 100, 500);
    if (args.entityType && args.entityId) {
      const et = args.entityType;
      const ei = args.entityId;
      return ctx.db
        .query("auditEvents")
        .withIndex("by_entity", (q) => q.eq("entityType", et).eq("entityId", ei))
        .order("desc")
        .take(limit);
    }
    return ctx.db.query("auditEvents").withIndex("by_at").order("desc").take(limit);
  },
});

/**
 * 制作物ごとの集計（A-4 の CSV 書き出し）。システム管理者のみ。
 * teamId に局を渡すとその局と配下の担当、担当を渡すとその担当を主管・制作担当にしている制作物に絞る。
 * CSV にするのは画面（domain の workStatsToCsv）。
 */
export const workStats = query({
  args: { teamId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => exportWorkStats(createReadContext(ctx.db), principal, args));
  },
});
