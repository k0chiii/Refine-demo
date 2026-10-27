import {
  buildPushPayload,
  isCategoryMuted,
  normalizeNotificationPrefs,
  type Principal,
  type PushContentPolicy,
  type PushPayload,
  pushOutcome,
  type PushSubscriptionInput,
  validatePushSubscription,
} from "@mf100/domain";
import type { AppContext, PushSubscriptionRecord } from "../ports.ts";
import { principalOf } from "../shared.ts";
import { presentNotifications } from "./notifications.ts";

/*
 * 端末への通知（Web Push）。利用者決定 2026-10-15。
 * 購読（どの端末に送るか）を保存し、通知ができたら、その人の端末ごとに送る内容（buildPushPayload）を作る。
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

export interface PushDelivery {
  payload: PushPayload;
  targets: Array<Pick<PushSubscriptionRecord, "id" | "endpoint" | "p256dh" | "auth">>;
}

/**
 * 通知 1 件を端末に送る計画。受信者の購読が無ければ null。
 * 送る時点でも見られるかを確かめ直す（作った後に ACL が外れたら、送り主・抜粋ごと伏せた内容にする）。
 * 既読になっていれば送らない（ほかの端末で先に読んだ）。
 * 受信者がその分類の通知を止めていれば送らない（アプリ内の通知は残る）。
 * 「通知に内容を表示」が切ってあれば、送り主と抜粋を載せない。
 */
export async function planPushDelivery(
  ctx: AppContext,
  notificationId: string,
  policy?: PushContentPolicy,
): Promise<PushDelivery | null> {
  const n = await ctx.notifications.findById(notificationId);
  if (!n || n.readAt !== undefined) return null;
  const prefs = normalizeNotificationPrefs(await ctx.notificationPrefs.find(n.recipientId));
  if (isCategoryMuted(prefs, n.kind)) return null;
  const subs = await ctx.pushSubscriptions.listByUser(n.recipientId);
  if (subs.length === 0) return null;
  // 受信者の担当の所属も添えて、非公開の制作物を所属で見られる人を伏せない
  const [shown] = await presentNotifications(
    ctx,
    principalOf(n.recipientId, await ctx.teams.list()),
    [n],
  );
  const hidden = n.workId !== undefined && shown?.workId === undefined;
  const work = !hidden && n.workId ? await ctx.works.findById(n.workId) : null;
  const shownNotification = shown ?? n;
  const restricted = work?.confidentiality === "restricted";
  // 送り主の名前は、載せるときだけ引く（伏せるとき・内容を出さないときは読まない）
  const showPreview = prefs.showPreview && (policy?.showPreview ?? true);
  const actorName =
    showPreview && !hidden && !restricted && shownNotification.actorId
      ? await ctx.people.displayName(shownNotification.actorId).catch(() => null)
      : null;
  const payload = buildPushPayload({
    notification: shownNotification,
    work: work ? { title: work.title, restricted: work.confidentiality === "restricted" } : null,
    hidden,
    actorName,
    showPreview: prefs.showPreview,
    unread: await ctx.notifications.countUnread(n.recipientId),
    ...(policy ? { policy } : {}),
  });
  return {
    payload,
    targets: subs.map(({ id, endpoint, p256dh, auth }) => ({ id, endpoint, p256dh, auth })),
  };
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
