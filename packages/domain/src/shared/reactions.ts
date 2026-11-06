import type { UserId } from "./ids.ts";

/**
 * リアクション（絵文字）。FB の投稿とレビューのコメント・返信が同じ種類・同じ規則を使う。
 * - 使える絵文字は決まったものだけ。表示はこの並び。
 * - 同じ人は 1 つの絵文字に 1 回だけ付けられる（もう一度押すと外れる）。
 * - 誰も付けていない絵文字の行は持たない。
 */
export const REACTIONS = ["👍", "🙏", "👀", "🎉", "💡", "❤️"] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface ReactionEntry {
  emoji: Reaction;
  userIds: UserId[];
}

export interface ReactionSummary {
  emoji: Reaction;
  count: number;
  mine: boolean;
  /** 付けた人（付けた順） */
  userIds: UserId[];
}

export function isReaction(value: string): value is Reaction {
  return (REACTIONS as readonly string[]).includes(value);
}

/** 付ける・外す（同じ人が同じ絵文字を押すと外れる）。誰も付けていない絵文字は消し、並びは REACTIONS の順 */
export function toggleReactionEntries(
  entries: readonly ReactionEntry[],
  emoji: Reaction,
  userId: UserId,
): ReactionEntry[] {
  const next = entries.map((r) => ({ emoji: r.emoji, userIds: [...r.userIds] }));
  const entry = next.find((r) => r.emoji === emoji);
  if (!entry) next.push({ emoji, userIds: [userId] });
  else if (entry.userIds.includes(userId))
    entry.userIds = entry.userIds.filter((id) => id !== userId);
  else entry.userIds.push(userId);
  const order = (e: Reaction) => REACTIONS.indexOf(e);
  return next.filter((r) => r.userIds.length > 0).sort((a, b) => order(a.emoji) - order(b.emoji));
}

/** 表示用の集計（絵文字・人数・自分が付けたか・付けた人）。決まった並びで、0 人の絵文字は出さない */
export function summarizeReactionEntries(
  entries: readonly ReactionEntry[],
  viewerId: UserId,
): ReactionSummary[] {
  return REACTIONS.flatMap((emoji) => {
    const r = entries.find((x) => x.emoji === emoji);
    if (!r || r.userIds.length === 0) return [];
    return [
      { emoji, count: r.userIds.length, mine: r.userIds.includes(viewerId), userIds: r.userIds },
    ];
  });
}
