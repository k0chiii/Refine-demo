import { DomainError } from "../shared/DomainError.ts";
import {
  isReaction,
  summarizeReactionEntries,
  toggleReactionEntries,
  type Reaction,
  type ReactionEntry,
} from "../shared/reactions.ts";
import type { UserId } from "../shared/ids.ts";
import type { WorkLifecycle } from "../work/Work.ts";
import { assertThreadNotDeleted, replyEntries } from "./deletion.ts";
import type { CommentEvent, CommentThread } from "./CommentThread.ts";

/**
 * コメント・返信へのリアクション（利用者決定 2026-10-18「コメントにもリアクション欲しい」）。
 * 絵文字の種類と付け外しの規則は FB と同じ（shared/reactions.ts）。
 *
 * - 付けられる人は返信と同じ（制作物を見られて、comment.reply を持つ人。権限の確認は usecase の loadAuthorizedWork）。校了後は不可。
 * - 付ける先はコメント（スレッド）と、削除されていない返信。削除されたものには付けられない。
 * - 同じ人は 1 つの絵文字に 1 回だけ。押すと付き、もう一度押すと外れる。
 */

export function validateCommentReaction(emoji: string): Reaction {
  if (!isReaction(emoji)) throw new DomainError("comment_reaction_invalid", { emoji });
  return emoji;
}

export function assertCanReactToComment(lifecycle: WorkLifecycle): void {
  if (lifecycle === "finalized") throw new DomainError("work_already_finalized");
}

/** コメントへのリアクションを付け外しした後のスレッド（削除済みのコメントには付けられない） */
export function toggleThreadReaction(
  thread: CommentThread,
  emoji: string,
  userId: UserId,
): CommentThread {
  const checked = validateCommentReaction(emoji);
  assertThreadNotDeleted(thread);
  const reactions = toggleReactionEntries(thread.reactions ?? [], checked, userId);
  const { reactions: _before, ...rest } = thread;
  void _before;
  return reactions.length > 0 ? { ...rest, reactions } : rest;
}

/**
 * 返信へのリアクションを付け外しした後の、その返信の一覧。events はスレッドの全イベント。
 * 返信でないもの・削除された返信は見つからない扱い（comment_reply_not_found）。
 */
export function toggleReplyReaction(
  events: readonly CommentEvent[],
  replyEventId: string,
  emoji: string,
  userId: UserId,
  threadId: string,
): ReactionEntry[] {
  const checked = validateCommentReaction(emoji);
  const reply = replyEntries(events).find((r) => r.id === replyEventId);
  if (!reply || reply.deleted)
    throw new DomainError("comment_reply_not_found", { threadId, replyEventId });
  const event = events.find((e) => e.id === replyEventId);
  return toggleReactionEntries(event?.reactions ?? [], checked, userId);
}

/** 表示用の集計（絵文字・人数・自分が付けたか・付けた人） */
export function summarizeCommentReactions(
  reactions: readonly ReactionEntry[] | undefined,
  viewerId: UserId,
) {
  return summarizeReactionEntries(reactions ?? [], viewerId);
}
