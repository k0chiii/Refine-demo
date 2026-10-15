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

/*
 * 通知の文面の型（UI_M3E §35 W-14）:
 * - 題名は「何が起きたか」の決まった文言（例「新しいコメント」）。制作物名などの変わる値は入れない
 * - 本文は「どの制作物の・どの版で・誰が」を先頭に置き、続けて抜粋や次の行動を書く
 *   例「『夏のポスター』第2版・山田さん: 3 行目の誤字…」
 */

/** 本文に入れる抜粋。改行・連続空白をつめ、長ければ切って「…」を付ける */
export function excerpt(text: string, max = 120): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

const weekdays = ["日", "月", "火", "水", "木", "金", "土"] as const;
/** 締切の日付（JST）: 「11/14（土）」 */
export function jstMonthDay(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${weekdays[d.getUTCDay()]}）`;
}

/** 「誰が」: 表示名に「さん」を付ける。分からなければ null */
export async function personName(ctx: AppContext, userId: string): Promise<string | null> {
  const name = await ctx.people.displayName(userId).catch(() => null);
  return name ? `${name}さん` : null;
}

/** 本文の頭: 「夏のポスター」第2版・山田さん（版・人は無ければ省く） */
export function about(workTitle: string, revision?: string | null, who?: string | null): string {
  return [`「${workTitle}」${revision ?? ""}`, who].filter(Boolean).join("・");
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
