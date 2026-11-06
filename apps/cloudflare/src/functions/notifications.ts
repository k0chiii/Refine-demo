import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  markThreadNotificationsRead,
  sendTestNotification,
} from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object, vId } from "./validators.ts";

// apps/convex/convex/notifications.ts の写し

export const notifications = {
  /**
   * 自分宛のアプリ内通知（F-11 最小通知）。新しい順。unreadOnly は未読だけ。
   * 今見られない制作物の通知は文面と ID を伏せて返す（§5.2-10。listMyNotifications が判定する）
   */
  "notifications:list": query({
    auth: "user",
    args: object({ limit: z.number().optional(), unreadOnly: z.boolean().optional() }),
    handler: async (ctx, { limit, unreadOnly }) =>
      listMyNotifications(ctx.db, ctx.principal!, Math.min(limit ?? 50, 200), {
        unreadOnly: unreadOnly === true,
      }),
  }),

  // Convex は notificationCounters 表を読む。ここは集計の派生表を持たず、notifications を数える
  "notifications:unreadCount": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => ctx.db.notifications.countUnread(ctx.userId!),
  }),

  "notifications:markRead": mutation({
    auth: "user",
    args: object({ notificationId: vId }),
    handler: async (ctx, { notificationId }) => {
      await markNotificationRead(ctx.db, ctx.principal!, notificationId);
      return null;
    },
  }),

  /** 校正画面でスレッドを開いたとき: そのスレッドの未読の通知をまとめて既読にする（利用者指示 2026-11-05） */
  "notifications:markThreadRead": mutation({
    auth: "user",
    args: object({ threadId: z.string() }),
    handler: async (ctx, { threadId }): Promise<number> =>
      markThreadNotificationsRead(ctx.db, ctx.principal!, threadId),
  }),

  "notifications:markUnread": mutation({
    auth: "user",
    args: object({ notificationId: vId }),
    handler: async (ctx, { notificationId }) => {
      await markNotificationUnread(ctx.db, ctx.principal!, notificationId);
      return null;
    },
  }),

  /** すべて既読。1 回分（上限つき）既読にして、この回で既読にした件数を返す */
  "notifications:markAllRead": mutation({
    auth: "user",
    args: object({}),
    handler: async (ctx): Promise<number> => {
      const r = await markAllNotificationsRead(ctx.db, ctx.principal!);
      // ponytail: scheduler.runAfter(notifications:continueMarkAllRead) は alarm の単位（U6）で移す
      return r.marked;
    },
  }),

  /** 通知の設定の「テスト通知を送る」（§112）。自分宛に 1 件作る。1 分に 1 回まで（test_notification_too_soon） */
  "notifications:sendTest": mutation({
    auth: "user",
    args: object({}),
    handler: async (ctx): Promise<null> => {
      await sendTestNotification(ctx.db, ctx.principal!);
      return null;
    },
  }),
} satisfies Record<string, FnDef>;
