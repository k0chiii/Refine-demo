import { isPushSubscribed, subscribePush, unsubscribePush } from "@mf100/application";
import { enqueueDeliveries, logDeliveryComplete } from "./delivery.ts";
import { deliveryPool } from "./lib/deliveryPool.ts";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { vapidKeysFromEnv } from "./lib/webpush.ts";

/*
 * 端末への通知（Web Push）。利用者決定 2026-10-15（外部への送信の承認）。
 * 鍵（VAPID_PUBLIC_KEY・VAPID_PRIVATE_KEY・VAPID_SUBJECT）が環境変数に無ければ使えない（config が null）。
 * 送るのは deliveryNode.deliver（通知を作ったときに adapters が予約する）。
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

/**
 * 旧（delivery.enqueue に替えた）。替える前に予約された分のため、1 回のデプロイの間残す。
 * `notificationId`（単数）は、さらに前の形で予約されていた分
 */
export const enqueue = internalMutation({
  args: {
    notificationIds: v.optional(v.array(v.string())),
    notificationId: v.optional(v.string()),
  },
  handler: async (ctx, { notificationIds = [], notificationId }) => {
    const ids = notificationId ? [...notificationIds, notificationId] : notificationIds;
    await enqueueDeliveries(ctx, ids);
  },
});

/** 旧（delivery.completed に替えた）。替える前に workpool に積んだ仕事の完了がこの名前を指す */
export const completed = deliveryPool.defineOnComplete({
  context: v.object({ notificationId: v.string() }),
  handler: async (_ctx, { context, result }) => {
    logDeliveryComplete(context.notificationId, result.kind);
  },
});
