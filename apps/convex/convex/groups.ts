import { deleteMemberGroup, listMemberGroups, saveMemberGroup } from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/**
 * メンバーのグループ（利用者指示 2026-10-21）。校正者の割り当てとメンションで、所属する人をまとめて選ぶ。
 * 作る・変える・消すのはシステム管理者だけ（ユースケースで確認）。一覧はサインインしていれば誰でも（選ぶ画面で使う）。
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => listMemberGroups(createReadContext(ctx.db), principal));
  },
});

export const save = mutation({
  args: {
    id: v.optional(v.string()),
    name: v.string(),
    memberIds: v.array(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const group = await saveMemberGroup(createAppContext(ctx), principal, args);
      return group.id;
    });
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await deleteMemberGroup(createAppContext(ctx), principal, id);
      return null;
    });
  },
});
