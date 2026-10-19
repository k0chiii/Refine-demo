import { DomainError } from "../shared/DomainError.ts";
import type { UserId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import type { WorkLifecycle } from "../work/Work.ts";
import type { CommentEvent, CommentThread } from "./CommentThread.ts";

/**
 * コメント・返信の削除（利用者決定 2026-10-18「コメントの削除機能欲しい。（投稿者のみ）」）。
 *
 * - 削除できるのは投稿した本人。校了後は不可（訂正と同じ）。
 * - システム管理者は、利用者指示 2026-10-19「管理者は全てのコメントやFB, スレッドを削除できるようにして欲しい」により、
 *   他人のコメント・返信も、校了後も削除できる（運用上の削除は常にできる必要がある。DECISIONS 2026-10-19）。閲覧権限は広げない。
 * - 論理削除: 行は消さず、スレッドに deletedAt を付け、CommentEvent("deleted" / "reply_deleted") を追記する。原文は履歴に残る。
 * - 削除したものは一覧に残さない（利用者指示 2026-10-19「「削除された投稿」として残さなくて良い。」）。
 *   スレッドを削除すると、スレッドと全ての返信を一緒に論理削除する（管理者は利用者決定 2026-10-19「まとめて消す」、本人も同じ）。
 *   返信だけを削除したときも、その返信は履歴に並べない。「削除されたコメント／返信」の行は作らない。
 * - 削除済みのスレッドは紙面の印・件数・未解決・校了の判定から外れる。
 */

/** 削除されていない（件数・紙面の印・校了の判定の対象になる）スレッドか */
export function isActiveThread(thread: Pick<CommentThread, "deletedAt">): boolean {
  return thread.deletedAt === undefined;
}

/** 削除する人。システム管理者かどうかだけを渡す（本人かの判定は authorId と actorId で行う） */
export interface DeleteActor {
  isSystemAdmin?: boolean;
}

/** 何の権限で削除できるか。本人（校了前）か、システム管理者（他人のものも・校了後も）か、できないか */
export type CommentDeleteAuthority = "author" | "admin";

export function commentDeleteAuthority(
  authorId: UserId,
  actorId: UserId,
  lifecycle: WorkLifecycle,
  actor: DeleteActor = {},
): CommentDeleteAuthority | null {
  if (authorId === actorId && lifecycle !== "finalized") return "author";
  return actor.isSystemAdmin === true ? "admin" : null;
}

/** 削除できるか。投稿者本人で校了前、またはシステム管理者 */
export function canDeleteComment(
  authorId: UserId,
  actorId: UserId,
  lifecycle: WorkLifecycle,
  actor: DeleteActor = {},
): boolean {
  return commentDeleteAuthority(authorId, actorId, lifecycle, actor) !== null;
}

export function assertCanDeleteComment(
  authorId: UserId,
  actorId: UserId,
  lifecycle: WorkLifecycle,
  actor: DeleteActor = {},
): CommentDeleteAuthority {
  const authority = commentDeleteAuthority(authorId, actorId, lifecycle, actor);
  if (authority !== null) return authority;
  if (authorId !== actorId) throw new DomainError("comment_delete_not_author");
  throw new DomainError("work_already_finalized");
}

/** 返信イベント 1 件の現在の状態（削除されたかは reply_deleted で導く） */
export interface ReplyEntry {
  id: string;
  actorId: UserId;
  deleted: boolean;
}

function deletedReplyIds(events: readonly CommentEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.eventType !== "reply_deleted") continue;
    const id = (e.payload as { replyEventId?: unknown } | undefined)?.replyEventId;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

export function replyEntries(events: readonly CommentEvent[]): ReplyEntry[] {
  const gone = deletedReplyIds(events);
  const out: ReplyEntry[] = [];
  for (const e of events) {
    if (e.eventType !== "replied" || e.id === undefined) continue;
    out.push({ id: e.id, actorId: e.actorId, deleted: gone.has(e.id) });
  }
  return out;
}

export function assertThreadNotDeleted(thread: Pick<CommentThread, "id" | "deletedAt">): void {
  if (thread.deletedAt !== undefined)
    throw new DomainError("comment_thread_deleted", { threadId: thread.id });
}

/** スレッド削除の計画。本人も管理者も、スレッドと削除されていない全ての返信をまとめて消す */
export interface ThreadDeletion {
  /** 削除後のスレッド */
  thread: CommentThread;
  authority: CommentDeleteAuthority;
  /** まとめて削除する返信イベントの ID（削除されていない返信すべて。呼び出し側が "reply_deleted" を追記する） */
  cascadeReplyIds: string[];
}

/**
 * スレッドの削除を計画する（原文は書き換えない。呼び出し側が reply_deleted と "deleted" イベントを追記する）。
 * 投稿者本人（校了前）もシステム管理者も、スレッドと全ての返信をまとめて論理削除する。一覧には何も残らない。
 * authority は監査に残すかの判定に使う（本人でも校了後は管理者の権限で削除する）。
 */
export function planThreadDeletion(
  thread: CommentThread,
  actorId: UserId,
  lifecycle: WorkLifecycle,
  events: readonly CommentEvent[],
  now: Instant,
  actor: DeleteActor = {},
): ThreadDeletion {
  const authority = assertCanDeleteComment(thread.authorId, actorId, lifecycle, actor);
  assertThreadNotDeleted(thread);
  return {
    thread: { ...thread, deletedAt: now },
    authority,
    cascadeReplyIds: replyEntries(events)
      .filter((r) => !r.deleted)
      .map((r) => r.id),
  };
}

/** スレッドを削除した後の状態（planThreadDeletion のスレッド側） */
export function deleteThreadComment(
  thread: CommentThread,
  actorId: UserId,
  lifecycle: WorkLifecycle,
  events: readonly CommentEvent[],
  now: Instant,
  actor: DeleteActor = {},
): CommentThread {
  return planThreadDeletion(thread, actorId, lifecycle, events, now, actor).thread;
}

/**
 * 返信を削除できるか確かめる。対象は返信イベントの ID。投稿者本人かシステム管理者だけ（削除済み・返信でないものは見つからない扱い）。
 * 呼び出し側が "reply_deleted" イベントを追記する。
 */
export function assertCanDeleteReply(
  thread: Pick<CommentThread, "id">,
  replyEventId: string,
  actorId: UserId,
  lifecycle: WorkLifecycle,
  events: readonly CommentEvent[],
  actor: DeleteActor = {},
): void {
  const reply = replyEntries(events).find((r) => r.id === replyEventId);
  if (!reply || reply.deleted)
    throw new DomainError("comment_reply_not_found", { threadId: thread.id, replyEventId });
  assertCanDeleteComment(reply.actorId, actorId, lifecycle, actor);
}

export interface ThreadEventView extends CommentEvent {
  id: string;
  /** 返信の削除ができるか（返信にだけ付く） */
  can?: { delete: boolean };
}

/**
 * 履歴の見せ方。削除された返信と、削除の記録（deleted / reply_deleted）は並べない（原文はイベントに残り、ここで見せないだけ）。
 * 削除したスレッド自体は一覧に出ないので、その履歴は呼び出し側が返さない。
 */
export function projectThreadEvents(
  events: readonly CommentEvent[],
  viewerId: UserId,
  lifecycle: WorkLifecycle,
  viewer: DeleteActor = {},
): ThreadEventView[] {
  const gone = deletedReplyIds(events);
  const out: ThreadEventView[] = [];
  for (const e of events) {
    if (e.eventType === "reply_deleted" || e.eventType === "deleted") continue;
    const id = e.id ?? "";
    if (e.eventType === "replied") {
      if (gone.has(id)) continue;
      out.push({
        ...e,
        id,
        can: { delete: canDeleteComment(e.actorId, viewerId, lifecycle, viewer) },
      });
      continue;
    }
    out.push({ ...e, id });
  }
  return out;
}

export type ThreadView<T extends CommentThread = CommentThread> = T & {
  /** 閲覧者ができる操作。画面は権限を推測せず、これに従う。削除すると返信もまとめて消える */
  can: { delete: boolean };
};

/**
 * 画面に渡すスレッド（削除されていないもの）。削除できるのは投稿者本人とシステム管理者。
 * 削除済みは一覧に出さないので、呼び出し側が渡す前に除く（listByRevision の既定）。
 */
export function presentThread<T extends CommentThread>(
  thread: T,
  viewerId: UserId,
  lifecycle: WorkLifecycle,
  viewer: DeleteActor = {},
): ThreadView<T> {
  return {
    ...thread,
    can: { delete: canDeleteComment(thread.authorId, viewerId, lifecycle, viewer) },
  };
}
