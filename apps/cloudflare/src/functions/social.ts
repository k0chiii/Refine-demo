import { deleteSocialProfile, listSocialProfiles, saveSocialProfile } from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/social.ts の写し。登録・変更・削除はシステム管理者だけ（use case が確かめる）

export const social = {
  /** 一覧はサインインしていれば誰でも（制作物への割り当て・プレビューで使う） */
  "social:list": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => listSocialProfiles(ctx.db, ctx.principal!),
  }),

  "social:save": mutation({
    auth: "user",
    args: object({
      id: z.string().optional(),
      platform: z.enum(["instagram", "x"]),
      displayName: z.string(),
      username: z.string(),
      avatar: z.string().optional(),
      bio: z.string().optional(),
      verified: z.boolean(),
      stats: object({
        posts: z.number().optional(),
        followers: z.number().optional(),
        following: z.number().optional(),
      }).optional(),
    }),
    handler: async (ctx, args) => {
      const p = await saveSocialProfile(ctx.db, ctx.principal!, args);
      return p.id;
    },
  }),

  "social:remove": mutation({
    auth: "user",
    args: object({ id: z.string() }),
    handler: async (ctx, { id }) => {
      await deleteSocialProfile(ctx.db, ctx.principal!, id);
      return null;
    },
  }),
} satisfies Record<string, FnDef>;
