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
    for (const target of plan.targets) {
      const status = await sendWebPush(target, plan.payload, keys, { now: Date.now() });
      if (status >= 200 && status < 300) sent++;
      await ctx.runMutation(internal.push.recordResult, { subscriptionId: target.id, status });
    }
    return sent;
  },
});
