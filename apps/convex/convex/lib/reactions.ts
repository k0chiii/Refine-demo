import { summarizeCommentReactions, type ReactionEntry } from "@mf100/domain";
import type { UserSummary } from "./users.ts";

/** 画面に渡すリアクションの集計（絵文字・人数・自分が付けたか・付けた人の名前）。付けた人の名前は users から引く */
export function reactionViews(
  entries: readonly ReactionEntry[] | undefined,
  viewerId: string,
  users: ReadonlyMap<string, UserSummary>,
) {
  return summarizeCommentReactions(entries, viewerId).map(({ userIds, ...r }) => ({
    ...r,
    users: userIds.map((id) => ({ id, name: users.get(id)?.name ?? "（不明なユーザー）" })),
  }));
}

/** 名前を引くための、リアクションを付けた人の ID */
export const reactorIds = (entries: readonly ReactionEntry[] | undefined): string[] =>
  (entries ?? []).flatMap((r) => r.userIds);
