import type { UserId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { CommentEvent, CommentThread } from "./CommentThread.ts";
import { replyEntries } from "./deletion.ts";

/**
 * スレッドのやり取り（返信の件数・参加者・最後の動き）と、人ごとの未読。
 * コメントを Slack のスレッドのように話せる場にする（利用者指示 2026-10-20「SlackのスレッドのUXを持ったDriveのコメント機能」）。
 *
 * - 動き（activity）は、スレッドを立てたことと、削除されていない返信。採否・担当・訂正は動きに数えない
 *   （それらは返信と違い、スレッドを開かなくても行え、読んだことにならないため）。
 * - 返信の件数・参加者・最後の動きはスレッドに持たせる（`withThreadActivity`。返信・返信の削除のたびに更新）。
 *   持っていない古いスレッドは、イベントから導く（`deriveThreadActivity`。移行しない）。
 * - 未読は FB と同じ規則: 最後に読んだ時刻が無い、または最後の動きより前。ただし最後の動きが自分のものなら未読にしない
 *   （自分の投稿でスレッドを未読にしない）。自動校正の指摘は、人が返信するまで未読にしない（数十件が一度に未読になるのを避ける）。
 */

/** 一覧で出す参加者の人数の上限（アバターを重ねて並べる） */
export const THREAD_PARTICIPANTS_SHOWN = 3;

export interface ThreadActivity {
  /** 最後の動き（スレッドを立てた時刻・最後の返信の時刻） */
  lastActivityAt: Instant;
  /** 最後の動きをした人 */
  lastActivityBy: UserId;
  /** 削除されていない返信の件数 */
  replyCount: number;
  /** 参加者（スレッドの投稿者が先頭、続いて返信した人を新しい順）。重複なし */
  participantIds: UserId[];
}

/** スレッドが持つやり取りの項目（無ければ古いスレッド） */
type ThreadActivityFields = Pick<
  CommentThread,
  "lastActivityAt" | "lastActivityBy" | "replyCount" | "participantIds"
>;

/** スレッドを立てた直後のやり取り（返信はまだ無い） */
export function initialThreadActivity(
  thread: Pick<CommentThread, "authorId" | "createdAt">,
): ThreadActivity {
  return {
    lastActivityAt: thread.createdAt,
    lastActivityBy: thread.authorId,
    replyCount: 0,
    participantIds: [thread.authorId],
  };
}

/** イベントからやり取りを導く（削除された返信は数えない） */
export function deriveThreadActivity(
  thread: Pick<CommentThread, "authorId" | "createdAt">,
  events: readonly CommentEvent[],
): ThreadActivity {
  const at = new Map<string, Instant>();
  for (const e of events)
    if (e.eventType === "replied" && e.id !== undefined) at.set(e.id, e.createdAt);
  const live = replyEntries(events)
    .filter((r) => !r.deleted)
    .map((r) => ({ actorId: r.actorId, at: at.get(r.id) ?? thread.createdAt }))
    .sort((a, b) => a.at - b.at);
  const last = live.at(-1);
  const repliers: UserId[] = [];
  for (const r of [...live].reverse()) if (!repliers.includes(r.actorId)) repliers.push(r.actorId);
  return {
    lastActivityAt: Math.max(thread.createdAt, last?.at ?? 0),
    lastActivityBy: last?.actorId ?? thread.authorId,
    replyCount: live.length,
    participantIds: [thread.authorId, ...repliers.filter((id) => id !== thread.authorId)],
  };
}

/** スレッドに持たせたやり取り（持っていなければ null） */
export function storedThreadActivity(thread: ThreadActivityFields): ThreadActivity | null {
  if (
    thread.lastActivityAt === undefined ||
    thread.lastActivityBy === undefined ||
    thread.replyCount === undefined ||
    thread.participantIds === undefined
  )
    return null;
  return {
    lastActivityAt: thread.lastActivityAt,
    lastActivityBy: thread.lastActivityBy,
    replyCount: thread.replyCount,
    participantIds: thread.participantIds,
  };
}

/** やり取りを持たせたスレッド（保存する形） */
export function withThreadActivity<T extends CommentThread>(thread: T, a: ThreadActivity): T {
  return {
    ...thread,
    lastActivityAt: a.lastActivityAt,
    lastActivityBy: a.lastActivityBy,
    replyCount: a.replyCount,
    participantIds: a.participantIds,
  };
}

/**
 * 未読か。`readAt` はその人がスレッドを最後に読んだ時刻（読んだことが無ければ null）。
 * 自分の動きは未読にしない。自動校正の指摘（origin）は、人の返信が付くまで未読にしない。
 */
export function isThreadUnread(
  thread: Pick<CommentThread, "origin">,
  activity: Pick<ThreadActivity, "lastActivityAt" | "lastActivityBy" | "replyCount">,
  viewerId: UserId,
  readAt: Instant | null,
): boolean {
  if (activity.lastActivityBy === viewerId) return false;
  if (thread.origin !== undefined && activity.replyCount === 0) return false;
  return readAt === null || readAt < activity.lastActivityAt;
}

/**
 * 返信の通知の宛先: スレッドの投稿者と、これまでに（削除されていない返信で）返信した人。返信した本人は除く。
 * メンションされた人には「メンション」の通知が別に行くので、重ねない（`mentioned`）。
 * 自動校正の指摘（origin）の投稿者はシステムなので、送らない。
 */
export function replyRecipients(
  thread: Pick<CommentThread, "authorId" | "origin">,
  events: readonly CommentEvent[],
  replierId: UserId,
  mentioned: readonly UserId[] = [],
): UserId[] {
  const people = [
    ...(thread.origin === undefined ? [thread.authorId] : []),
    ...replyEntries(events)
      .filter((r) => !r.deleted)
      .map((r) => r.actorId),
  ];
  const out: UserId[] = [];
  for (const id of people)
    if (id !== replierId && !mentioned.includes(id) && !out.includes(id)) out.push(id);
  return out;
}
