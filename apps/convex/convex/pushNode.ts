"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { sendWebPush, vapidKeysFromEnv } from "./lib/webpush.ts";

/**
 * 通知 1 件を受信者の端末に送る（Web Push）。Node ランタイムで動かす（WebCrypto の ECDH・HKDF を確実に使うため）。
 * 送る内容は送る時点で作る（既読・閲覧権限の変化を反映。push.plan）。送った結果で購読を整理する。
 */
export const deliver = internalAction({
  args: { notificationId: v.string() },
  handler: async (ctx, { notificationId }): Promise<number> => {
    const keys = vapidKeysFromEnv(process.env);
    if (!keys) return 0;
    const plan = await ctx.runQuery(internal.push.plan, { notificationId });
    if (!plan) return 0;
    let sent = 0;
    let retry = false;
    for (const target of plan.targets) {
      if (
        await ctx.runQuery(internal.push.delivered, { notificationId, subscriptionId: target.id })
      )
        continue;
      // Recheck authorization/read status immediately before each external send.
      const current = await ctx.runQuery(internal.push.plan, { notificationId });
      if (!current || !current.targets.some((t) => t.id === target.id)) continue;
      let status: number;
      try {
        status = await sendWebPush(target, current.payload, keys, { now: Date.now() });
      } catch {
        retry = true;
        continue;
      }
      if (status === 429 || status >= 500) {
        retry = true;
        continue;
      }
      // A crash between send and record is at-least-once; the browser uses notificationId as tag.
      await ctx.runMutation(internal.push.recordDelivery, {
        notificationId,
        subscriptionId: target.id,
        status,
      });
      if (status >= 200 && status < 300) sent++;
      await ctx.runMutation(internal.push.recordResult, { subscriptionId: target.id, status });
    }
    if (retry) throw new Error("push_transient_failure");
    return sent;
  },
});
