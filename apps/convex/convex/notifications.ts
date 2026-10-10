import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/** 自分宛のアプリ内通知（F-11 最小通知）。新しい順。 */
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
      await markNotificationRead(createAppContext(ctx.db), principal, notificationId);
      return null;
    });
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => markAllNotificationsRead(createAppContext(ctx.db), principal));
  },
});
