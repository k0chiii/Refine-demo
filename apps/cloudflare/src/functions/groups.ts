import { deleteMemberGroup, listMemberGroups, saveMemberGroup } from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/groups.ts の写し。作る・変える・消すのは groups:manage を持つ人とシステム管理者（use case が確かめる）

export const groups = {
  /** 一覧はサインインしていれば誰でも（選ぶ画面で使う） */
  "groups:list": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => listMemberGroups(ctx.db, ctx.principal!),
  }),

  "groups:save": mutation({
    auth: "user",
    args: object({
      id: z.string().optional(),
      name: z.string(),
      memberIds: z.array(z.string()),
      order: z.number().optional(),
    }),
    handler: async (ctx, args) => {
      const group = await saveMemberGroup(ctx.db, ctx.principal!, args);
      return group.id;
    },
  }),

  "groups:remove": mutation({
    auth: "user",
    args: object({ id: z.string() }),
    handler: async (ctx, { id }) => {
      await deleteMemberGroup(ctx.db, ctx.principal!, id);
      return null;
    },
  }),
} satisfies Record<string, FnDef>;
