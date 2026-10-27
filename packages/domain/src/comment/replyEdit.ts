import { DomainError } from "../shared/DomainError.ts";
import type { UserId } from "../shared/ids.ts";
import type { WorkLifecycle } from "../work/Work.ts";
import { type CommentBodyFormat, isCommentBodyFormat, validateCommentBody } from "./body.ts";
import type { CommentEvent, CommentThread } from "./CommentThread.ts";
import { replyEntries } from "./deletion.ts";

/**
 * 返信の訂正（利用者指示 2026-10-26「スレッドの中も編集可能にしてほしいです！」）。
 *
 * - 今の本文は返信のイベント（replied の payload.body / bodyFormat）に置き、訂正前の本文は "reply_edited" に残す（§5.2-9）。
 *   返信の本文を読む側（一覧・通知・流れ）は今の本文だけを読めばよい。
 * - 採否の後も返信はできるので、訂正も採否で止めない。
 * - 訂正は動きに数えない（未読・最後の動きを変えない。元のコメントの訂正と同じ）。
 */

export interface ReplyBody {
  body: string;
  bodyFormat?: CommentBodyFormat;
}

/** "reply_edited" の payload */
export interface ReplyEditRecord {
  replyEventId: string;
  previousBody: string;
  previousBodyFormat?: CommentBodyFormat;
  bodyFormat?: CommentBodyFormat;
}

export type ReplyEdit =
  | { changed: false }
  | { changed: true; replyEventId: string; next: ReplyBody; previous: ReplyEditRecord };

/** 返信した本人で校了前だけ。管理者の例外は無い（他人の言葉は書き換えない） */
export function canEditReply(authorId: UserId, actorId: UserId, lifecycle: WorkLifecycle): boolean {
  return authorId === actorId && lifecycle !== "finalized";
}

/** 返信の訂正を計画する。呼び出し側が返信の本文を next に置き換え、previous を "reply_edited" として追記する */
export function planReplyEdit(
  thread: Pick<CommentThread, "id">,
  replyEventId: string,
  actorId: UserId,
  body: string,
  bodyFormat: string | undefined,
  lifecycle: WorkLifecycle,
  events: readonly CommentEvent[],
): ReplyEdit {
  const reply = replyEntries(events).find((r) => r.id === replyEventId);
  if (!reply || reply.deleted)
    throw new DomainError("comment_reply_not_found", { threadId: thread.id, replyEventId });
  if (reply.actorId !== actorId)
    throw new DomainError("comment_edit_not_author", { threadId: thread.id, replyEventId });
  if (lifecycle === "finalized") throw new DomainError("work_already_finalized");
  if (body.trim() === "" && reply.fileIds.length === 0)
    throw new DomainError("forbidden", { reason: "body_required" });
  const format = validateCommentBody(body, bodyFormat);
  const payload = events.find((e) => e.id === replyEventId)!.payload ?? {};
  const previousBody = typeof payload.body === "string" ? payload.body : "";
  const previousFormat = isCommentBodyFormat(payload.bodyFormat) ? payload.bodyFormat : undefined;
  if (previousBody === body && previousFormat === format) return { changed: false };
  return {
    changed: true,
    replyEventId,
    next: { body, ...(format ? { bodyFormat: format } : {}) },
    previous: {
      replyEventId,
      previousBody,
      ...(previousFormat ? { previousBodyFormat: previousFormat } : {}),
      ...(format ? { bodyFormat: format } : {}),
    },
  };
}
