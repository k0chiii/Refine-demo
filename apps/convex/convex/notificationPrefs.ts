import { getNotificationPrefs, updateNotificationPrefs } from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/**
 * 通知の受け取り方（利用者ごと。外への通知に効く。利用者指示 2026-10-18・2026-10-28）。
 * 自分の設定だけを読み書きする。アプリ内の通知（ベルの一覧）は設定にかかわらず作られる。
 */

/** 自分の設定（無ければ既定: 内容を表示・止めている分類なし） */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    return getNotificationPrefs(createReadContext(ctx.db), principal);
  },
});

/** 渡した項目だけを変える。変えたあとの設定を返す */
export const update = mutation({
  args: {
    showPreview: v.optional(v.boolean()),
    mutedCategories: v.optional(v.array(v.string())),
    channels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => updateNotificationPrefs(createAppContext(ctx), principal, args));
  },
});
