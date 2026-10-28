import {
  type Principal,
  pushOutcome,
  type PushSubscriptionInput,
  validatePushSubscription,
} from "@mf100/domain";
import type { AppContext, PushSubscriptionRecord } from "../ports.ts";

/*
 * 端末への通知（Web Push）。利用者決定 2026-10-15。
 * 購読（どの端末に送るか）を保存し、送った結果で購読を整理する。送る計画は usecases/delivery.ts（メール・Slack と共通）。
 * 送ること自体（暗号化・プッシュサービスへの送信）はアダプタ（Convex の action）の仕事。
 */

/**
 * この端末に通知を送るようにする。同じ端末（endpoint）が別の人で登録済みなら、今の人に付け替える
 * （共用の端末でサインインし直した。前の人の通知を出さない）。
 */
export async function subscribePush(
  ctx: AppContext,
  principal: Principal,
  input: PushSubscriptionInput & { device?: string },
): Promise<PushSubscriptionRecord> {
  const sub = validatePushSubscription(input);
  const device = input.device?.trim().slice(0, 80) || undefined;
  const existing = await ctx.pushSubscriptions.findByEndpoint(sub.endpoint);
  if (existing) {
    const next: PushSubscriptionRecord = {
      ...existing,
      ...sub,
      userId: principal.userId,
      failureCount: 0,
    };
    if (device) next.device = device;
    await ctx.pushSubscriptions.update(next);
    return next;
  }
  return ctx.pushSubscriptions.insert({
    userId: principal.userId,
    ...sub,
    ...(device ? { device } : {}),
    createdAt: ctx.clock.now(),
    failureCount: 0,
  });
}

/** この端末への通知をやめる（自分の購読だけ。無ければ何もしない） */
export async function unsubscribePush(
  ctx: AppContext,
  principal: Principal,
  endpoint: string,
): Promise<boolean> {
  const existing = await ctx.pushSubscriptions.findByEndpoint(endpoint);
  if (!existing || existing.userId !== principal.userId) return false;
  await ctx.pushSubscriptions.delete(existing.id);
  return true;
}

/** この端末に送っているか（設定の表示用。自分の購読だけを見る） */
export async function isPushSubscribed(
  ctx: AppContext,
  principal: Principal,
  endpoint: string,
): Promise<boolean> {
  const existing = await ctx.pushSubscriptions.findByEndpoint(endpoint);
  return existing !== null && existing.userId === principal.userId;
}

/**
 * 送った結果を記録する（成功で失敗回数を 0 に。宛先が無くなった・続けて失敗したら購読を消す）。
 * 同じ端末への配信は workpool で並んで走るので、失敗回数が変わらない成功では書かない。
 * 毎回書くと同じ購読への書き込みがぶつかり、Convex がやり直していた（Convex Insights 2026-10-26）
 */
export async function recordPushResult(
  ctx: AppContext,
  subscriptionId: string,
  status: number,
): Promise<"kept" | "deleted" | "missing"> {
  const sub = await ctx.pushSubscriptions.findById(subscriptionId);
  if (!sub) return "missing";
  const r = pushOutcome(status, sub.failureCount);
  if (r.action === "delete") {
    await ctx.pushSubscriptions.delete(sub.id);
    return "deleted";
  }
  if (r.failureCount !== sub.failureCount) {
    await ctx.pushSubscriptions.update({ ...sub, failureCount: r.failureCount });
  }
  return "kept";
}
