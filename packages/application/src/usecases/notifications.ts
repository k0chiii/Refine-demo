import { DomainError, type Principal } from "@mf100/domain";
import type { AppContext, Notification, NotificationKind } from "../ports.ts";

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body: string;
  workId?: string;
  revisionId?: string;
  threadId?: string;
}

/**
 * 複数の受信者にアプリ内通知を作る。本人（actor）には送らない。重複受信者は 1 回。
 * 通知の失敗は業務更新を失敗させない（§10-4）ため、呼び出し側は await しても例外を業務に伝播させない。
 */
export async function notify(
  ctx: AppContext,
  recipients: Iterable<string>,
  actorId: string | null,
  input: NotifyInput,
): Promise<number> {
  const now = ctx.clock.now();
  let count = 0;
  for (const recipientId of new Set(recipients)) {
    if (!recipientId || recipientId === actorId) continue;
    try {
      const n: Omit<Notification, "id"> = {
        recipientId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        createdAt: now,
      };
      if (input.workId !== undefined) n.workId = input.workId;
      if (input.revisionId !== undefined) n.revisionId = input.revisionId;
      if (input.threadId !== undefined) n.threadId = input.threadId;
      await ctx.notifications.insert(n);
      count++;
    } catch {
      // 通知の失敗で業務処理を止めない
    }
  }
  return count;
}

export async function listMyNotifications(
  ctx: AppContext,
  principal: Principal,
  limit = 50,
): Promise<Notification[]> {
  return ctx.notifications.listForUser(principal.userId, limit);
}

export async function markNotificationRead(
  ctx: AppContext,
  principal: Principal,
  id: string,
): Promise<void> {
  const n = await ctx.notifications.findById(id);
  if (!n || n.recipientId !== principal.userId)
    throw new DomainError("forbidden", { notificationId: id });
  if (n.readAt !== undefined) return;
  await ctx.notifications.update({ ...n, readAt: ctx.clock.now() });
}

export async function markAllNotificationsRead(
  ctx: AppContext,
  principal: Principal,
): Promise<number> {
  const now = ctx.clock.now();
  let count = 0;
  for (const n of await ctx.notifications.listForUser(principal.userId, 200)) {
    if (n.readAt !== undefined) continue;
    await ctx.notifications.update({ ...n, readAt: now });
    count++;
  }
  return count;
}

/** 作品の職責者（制作者・主管・校了者）。通知の既定の宛先。 */
export function workStakeholders(work: {
  creatorIds: readonly string[];
  managerIds: readonly string[];
  approverId: string;
}): string[] {
  return [...work.creatorIds, ...work.managerIds, work.approverId];
}
