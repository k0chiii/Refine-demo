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
 * - 他の人の返信が残るスレッドは一覧に「削除されたコメント」として残し（返信の文脈を保つ）、無ければ一覧からも消す。
 * - 削除済みのスレッドは紙面の印・件数・未解決・校了の判定から外れる。
 */

export const DELETED_COMMENT_PLACEHOLDER = "削除されたコメント";
export const DELETED_REPLY_PLACEHOLDER = "削除された返信";

/** 削除されていない（件数・紙面の印・校了の判定の対象になる）スレッドか */
export function isActiveThread(thread: Pick<CommentThread, "deletedAt">): boolean {
  return thread.deletedAt === undefined;
}

/** 一覧に出すスレッドか（削除済みでも、他の人の返信が残っていれば「削除されたコメント」として出す） */
export function isListedThread(
  thread: Pick<CommentThread, "deletedAt" | "deletedKeepsReplies">,
): boolean {
  return thread.deletedAt === undefined || thread.deletedKeepsReplies === true;
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

/** 投稿者以外の人の、削除されていない返信があるか */
function hasLiveRepliesFromOthers(thread: CommentThread, events: readonly CommentEvent[]): boolean {
  return replyEntries(events).some((r) => !r.deleted && r.actorId !== thread.authorId);
}

export function assertThreadNotDeleted(thread: Pick<CommentThread, "id" | "deletedAt">): void {
  if (thread.deletedAt !== undefined)
    throw new DomainError("comment_thread_deleted", { threadId: thread.id });
}

/** スレッドを削除した後の状態（原文は書き換えない。呼び出し側が "deleted" イベントを追記する） */
export function deleteThreadComment(
  thread: CommentThread,
  actorId: UserId,
  lifecycle: WorkLifecycle,
  events: readonly CommentEvent[],
  now: Instant,
  actor: DeleteActor = {},
): CommentThread {
  assertCanDeleteComment(thread.authorId, actorId, lifecycle, actor);
  assertThreadNotDeleted(thread);
  return {
    ...thread,
    deletedAt: now,
    deletedKeepsReplies: hasLiveRepliesFromOthers(thread, events),
  };
}

/**
 * 返信を削除する。対象は返信イベントの ID。投稿者本人かシステム管理者だけ（削除済み・返信でないものは見つからない扱い）。
 * 返す thread は、残っていた他の人の返信が全て無くなった「削除されたコメント」を一覧から外した状態（変わらなければ同じ値）。
 * 呼び出し側が "reply_deleted" イベントを追記する。
 */
export function deleteReply(
  thread: CommentThread,
  replyEventId: string,
  actorId: UserId,
  lifecycle: WorkLifecycle,
  events: readonly CommentEvent[],
  actor: DeleteActor = {},
): CommentThread {
  const reply = replyEntries(events).find((r) => r.id === replyEventId);
  if (!reply || reply.deleted)
    throw new DomainError("comment_reply_not_found", { threadId: thread.id, replyEventId });
  assertCanDeleteComment(reply.actorId, actorId, lifecycle, actor);
  if (thread.deletedAt === undefined || thread.deletedKeepsReplies !== true) return thread;
  // 削除した後に、他の人の返信がまだ残るか
  const remaining = replyEntries(events).some(
    (r) => !r.deleted && r.id !== replyEventId && r.actorId !== thread.authorId,
  );
  return remaining ? thread : { ...thread, deletedKeepsReplies: false };
}

export interface ThreadEventView extends CommentEvent {
  id: string;
  /** 削除された返信（本文は伏せてある） */
  deleted?: boolean;
  /** 返信の削除ができるか（返信にだけ付く） */
  can?: { delete: boolean };
}

/**
 * 履歴の見せ方。削除された返信は本文を伏せ、削除の記録（deleted / reply_deleted）は並べない。
 * 削除したスレッドの訂正前の本文も伏せる。原文はイベントに残り、ここで見せないだけ。
 */
export function projectThreadEvents(
  thread: Pick<CommentThread, "deletedAt">,
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
      if (gone.has(id)) {
        const { payload: _payload, reactions: _reactions, ...rest } = e;
        void [_payload, _reactions];
        out.push({
          ...rest,
          id,
          deleted: true,
          payload: { body: DELETED_REPLY_PLACEHOLDER },
          can: { delete: false },
        });
      } else {
        out.push({
          ...e,
          id,
          can: { delete: canDeleteComment(e.actorId, viewerId, lifecycle, viewer) },
        });
      }
      continue;
    }
    if (e.eventType === "edited" && thread.deletedAt !== undefined) {
      const { payload: _payload, ...rest } = e;
      void _payload;
      out.push({ ...rest, id });
      continue;
    }
    out.push({ ...e, id });
  }
  return out;
}

export type ThreadView<T extends CommentThread = CommentThread> = T & {
  /** 削除されたコメント（本文・位置・メンションは伏せてある。返信の文脈のために残している） */
  deleted: boolean;
  /** 閲覧者ができる操作。画面は権限を推測せず、これに従う */
  can: { delete: boolean };
};

/**
 * 画面に渡すスレッド。削除済みは本文・位置・メンション・担当を伏せる（紙面の印も出ない）。
 * 削除できるのは投稿者本人とシステム管理者で、削除済みには何もできない。
 */
export function presentThread<T extends CommentThread>(
  thread: T,
  viewerId: UserId,
  lifecycle: WorkLifecycle,
  viewer: DeleteActor = {},
): ThreadView<T> {
  if (thread.deletedAt === undefined) {
    return {
      ...thread,
      deleted: false,
      can: { delete: canDeleteComment(thread.authorId, viewerId, lifecycle, viewer) },
    };
  }
  const {
    anchor: _anchor,
    artifactId: _artifactId,
    mentions: _mentions,
    assigneeId: _assigneeId,
    carriedFromThreadId: _carriedFrom,
    origin: _origin,
    reactions: _reactions,
    ...rest
  } = thread;
  void [_anchor, _artifactId, _mentions, _assigneeId, _carriedFrom, _origin, _reactions];
  return {
    ...(rest as T),
    body: DELETED_COMMENT_PLACEHOLDER,
    deleted: true,
    can: { delete: false },
  };
}
