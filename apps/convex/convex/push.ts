import {
  isPushSubscribed,
  planPushDelivery,
  recordPushResult,
  subscribePush,
  unsubscribePush,
} from "@mf100/application";
import { internal } from "./_generated/api";
import { pushPool } from "./lib/pushPool.ts";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { vapidKeysFromEnv } from "./lib/webpush.ts";

/*
 * 端末への通知（Web Push）。利用者決定 2026-10-15（外部への送信の承認）。
 * 鍵（VAPID_PUBLIC_KEY・VAPID_PRIVATE_KEY・VAPID_SUBJECT）が環境変数に無ければ使えない（config が null）。
 * 送るのは pushNode.deliver（通知を作ったときに adapters が予約する）。
 */

/** ブラウザに渡す公開鍵。鍵が無い（Web Push を使わない）環境では null */
export const config = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const keys = vapidKeysFromEnv(process.env);
    return keys ? { publicKey: keys.publicKey } : null;
  },
});

/** この端末（endpoint）に自分宛ての通知を送っているか */
export const status = query({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const { principal } = await requireUser(ctx);
    return isPushSubscribed(createReadContext(ctx.db), principal, endpoint);
  },
});

export const subscribe = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    device: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await subscribePush(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const { principal } = await requireUser(ctx);
    return unsubscribePush(createAppContext(ctx), principal, endpoint);
  },
});

/** 送る計画（内部用。pushNode.deliver から読む） */
export const plan = internalQuery({
  args: { notificationId: v.string() },
  handler: async (ctx, { notificationId }) =>
    planPushDelivery(createReadContext(ctx.db), notificationId),
});

/** 送った結果（内部用） */
export const recordResult = internalMutation({
  args: { subscriptionId: v.string(), status: v.number() },
  handler: async (ctx, { subscriptionId, status }) =>
    recordPushResult(createAppContext(ctx), subscriptionId, status),
});

/**
 * 通知を作ったトランザクションが予約する（1 トランザクションに 1 本。adapters の pushBatch）。workpool が同時数を抑え、
 * 一時的な失敗をやり直す。同じ予約の中で複数の通知を積むので、workpool の起動（batch-worker への ping）は 1 回で済む。
 * `notificationId`（単数）は、この形に替える前に予約されていた分のため
 */
export const enqueue = internalMutation({
  args: {
    notificationIds: v.optional(v.array(v.string())),
    notificationId: v.optional(v.string()),
  },
  handler: async (ctx, { notificationIds = [], notificationId }) => {
    const ids = notificationId ? [...notificationIds, notificationId] : notificationIds;
    for (const id of ids) {
      const args = { notificationId: id };
      await pushPool.enqueueAction(ctx, internal.pushNode.deliver, args, {
        onComplete: internal.push.completed,
        context: args,
      });
    }
  },
});

export const delivered = internalQuery({
  args: { notificationId: v.string(), subscriptionId: v.string() },
  handler: async (ctx, args) =>
    (await ctx.db
      .query("pushDeliveries")
      .withIndex("by_notification_and_subscription", (q) =>
        q.eq("notificationId", args.notificationId).eq("subscriptionId", args.subscriptionId),
      )
      .unique()) !== null,
});

export const recordDelivery = internalMutation({
  args: { notificationId: v.string(), subscriptionId: v.string(), status: v.number() },
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query("pushDeliveries")
      .withIndex("by_notification_and_subscription", (q) =>
        q.eq("notificationId", args.notificationId).eq("subscriptionId", args.subscriptionId),
      )
      .unique();
    if (!previous) await ctx.db.insert("pushDeliveries", { ...args, deliveredAt: Date.now() });
  },
});

export const completed = pushPool.defineOnComplete({
  context: v.object({ notificationId: v.string() }),
  handler: async (_ctx, { context, result }) => {
    console.log(
      JSON.stringify({
        event: "push_complete",
        notificationId: context.notificationId,
        outcome: result.kind,
      }),
    );
  },
});
