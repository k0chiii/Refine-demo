import { deleteSocialProfile, listSocialProfiles, saveSocialProfile } from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/**
 * SNS のアカウント（本体の設定）。登録・変更・削除はシステム管理者だけ（ユースケースで確認）。
 * 一覧はサインインしていれば誰でも（制作物への割り当て・プレビューで使う）。
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => listSocialProfiles(createReadContext(ctx.db), principal));
  },
});

export const save = mutation({
  args: {
    id: v.optional(v.string()),
    platform: v.union(v.literal("instagram"), v.literal("x")),
    displayName: v.string(),
    username: v.string(),
    avatar: v.optional(v.string()),
    bio: v.optional(v.string()),
    verified: v.boolean(),
    stats: v.optional(
      v.object({
        posts: v.optional(v.number()),
        followers: v.optional(v.number()),
        following: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const p = await saveSocialProfile(createAppContext(ctx.db), principal, args);
      return p.id;
    });
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await deleteSocialProfile(createAppContext(ctx.db), principal, id);
      return null;
    });
  },
});
