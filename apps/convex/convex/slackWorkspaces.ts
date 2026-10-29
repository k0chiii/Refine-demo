import { addSlackWorkspace, listSlackWorkspaces, removeSlackWorkspace } from "@mf100/application";
import type { SlackWorkspace } from "@mf100/domain";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/**
 * Slack のワークスペース（管理画面「Slack」。docs/UI_M3E.md §105）。登録・削除はシステム管理者だけ（ユースケースで確認し、
 * 監査に残す）。一覧はサインインしていれば誰でも。各自は通知の設定（notificationPrefs.update の slackWorkspaceId）で選ぶ
 */
export const list = query({
  args: {},
  handler: async (ctx): Promise<SlackWorkspace[]> => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => listSlackWorkspaces(createReadContext(ctx.db), principal));
  },
});

/** 名前と team_id（T で始まる。大文字にそろえる）で登録し、登録したものを返す */
export const add = mutation({
  args: { name: v.string(), teamId: v.string() },
  handler: async (ctx, args): Promise<SlackWorkspace> => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => addSlackWorkspace(createAppContext(ctx), principal, args));
  },
});

/** 削除する（もう無ければ何もしない）。選んでいた人には送らなくなる */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }): Promise<null> => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await removeSlackWorkspace(createAppContext(ctx), principal, id);
      return null;
    });
  },
});
