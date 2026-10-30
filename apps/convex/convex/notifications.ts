import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markUnreadNotificationsRead,
  sendTestNotification,
} from "@mf100/application";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/**
 * 自分宛のアプリ内通知（F-11 最小通知）。新しい順。
 * 今見られない制作物の通知は文面と ID を伏せて返す（§5.2-10。listMyNotifications が判定する）。
 */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() =>
      listMyNotifications(createReadContext(ctx.db), principal, Math.min(limit ?? 50, 200)),
    );
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    return createReadContext(ctx.db).notifications.countUnread(principal.userId);
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await markNotificationRead(createAppContext(ctx), principal, notificationId);
      return null;
    });
  },
});

/**
 * すべて既読。未読の索引から押した時刻までの未読を 1 回分（上限つき）既読にし、残りがあれば
 * 同じ時刻で続きを予約する（1 トランザクションの書込み上限に収める）。この回で既読にした件数を返す。
 */
export const markAllRead = mutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const { principal } = await requireUser(ctx);
    const r = await runUseCase(() => markAllNotificationsRead(createAppContext(ctx), principal));
    if (r.hasMore)
      await ctx.scheduler.runAfter(0, internal.notifications.continueMarkAllRead, {
        userId: principal.userId,
        asOf: r.asOf,
      });
    return r.marked;
  },
});

/** 「すべて既読」の続き（内部用。userId は markAllRead が認証済みの本人から渡す） */
export const continueMarkAllRead = internalMutation({
  args: { userId: v.string(), asOf: v.number() },
  handler: async (ctx, { userId, asOf }): Promise<number> => {
    const r = await markUnreadNotificationsRead(createAppContext(ctx), userId, asOf);
    if (r.hasMore)
      await ctx.scheduler.runAfter(0, internal.notifications.continueMarkAllRead, {
        userId,
        asOf,
      });
    return r.marked;
  },
});

/**
 * 通知の設定の「テスト通知を送る」（§112）。自分宛に 1 件作る。外への配信は insert が本物の通知と同じく予約する。
 * 1 分に 1 回まで（test_notification_too_soon）
 */
export const sendTest = mutation({
  args: {},
  handler: async (ctx): Promise<null> => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await sendTestNotification(createAppContext(ctx), principal);
      return null;
    });
  },
});
