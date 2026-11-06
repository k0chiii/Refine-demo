import type { DatabaseReader, DatabaseWriter } from "../_generated/server";

/**
 * 利用者ごとの未読の通知の数（notificationCounters）。notifications.unreadCount は全画面で購読されるので、
 * 通知の行（件名・本文つき）を数えずにこの 1 行だけを読む（Convex Insights 2026-11-06: 数えるために 1 日 ~25 MB 読んでいた）。
 *
 * - 通知の行を書く処理（作成・既読・未読に戻す）は、同じトランザクションで adjustUnreadCounter を呼ぶ（lib/adapters.ts）。
 * - 行が無い利用者（移行前）は、従来どおり未読の索引で FALLBACK_COUNT_LIMIT 件まで数える。
 *   書込みのときに数え切れる（LAZY_COUNT_LIMIT 件以下）なら、その時点の正しい数で行を作る。
 * - 全員の行を埋めるのは migrations:backfillNotificationCounters（運用者が実行。デプロイでは走らない）。
 */

/** 行が無いときの従来の上限（以前の unreadCount と同じ値を返す） */
export const FALLBACK_COUNT_LIMIT = 100;
/** 書込みのついでに行を作るために数える上限。超えたら行を作らず、移行に任せる */
export const LAZY_COUNT_LIMIT = 100;

function counterRow(db: DatabaseReader, userId: string) {
  return db
    .query("notificationCounters")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

function unreadNotifications(db: DatabaseReader, userId: string) {
  return db
    .query("notifications")
    .withIndex("by_recipient_read_created", (q) =>
      q.eq("recipientId", userId).eq("readAt", undefined),
    );
}

/** 未読の数。行があればその値、無ければ未読の索引で FALLBACK_COUNT_LIMIT 件まで数える */
export async function readUnreadCount(db: DatabaseReader, userId: string): Promise<number> {
  const row = await counterRow(db, userId);
  if (row) return row.unread;
  return (await unreadNotifications(db, userId).take(FALLBACK_COUNT_LIMIT)).length;
}

/**
 * 通知の行を書いた**後**に呼ぶ（delta は未読の増減）。行があれば増減し、無ければ書いた後の未読を数えて行を作る
 * （LAZY_COUNT_LIMIT 件を超えるなら作らない）。tooManyToCount は同じトランザクションで数え直さないための覚え
 */
export async function adjustUnreadCounter(
  db: DatabaseWriter,
  userId: string,
  delta: number,
  tooManyToCount: Set<string>,
): Promise<void> {
  if (delta === 0) return;
  const row = await counterRow(db, userId);
  if (row) {
    await db.patch("notificationCounters", row._id, { unread: Math.max(0, row.unread + delta) });
    return;
  }
  if (tooManyToCount.has(userId)) return;
  const counted = (await unreadNotifications(db, userId).take(LAZY_COUNT_LIMIT + 1)).length;
  if (counted > LAZY_COUNT_LIMIT) {
    tooManyToCount.add(userId);
    return;
  }
  await db.insert("notificationCounters", { userId, unread: counted });
}

/** 未読を全部数え直して行を書く（移行用。冪等。未読が多い利用者は多くの行を読む） */
export async function recountUnread(db: DatabaseWriter, userId: string): Promise<number> {
  let unread = 0;
  for await (const n of unreadNotifications(db, userId)) {
    void n;
    unread++;
  }
  const row = await counterRow(db, userId);
  if (!row) await db.insert("notificationCounters", { userId, unread });
  else if (row.unread !== unread) await db.patch("notificationCounters", row._id, { unread });
  return unread;
}
