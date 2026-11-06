import type { ThreadActivityView } from "@mf100/application";
import { groupMentionToken, summarizeCommentReactions, type ReactionEntry } from "@mf100/domain";
import type { AppContext } from "@mf100/application";
import type { UserSummary } from "./users.ts";

// apps/convex/convex/lib/{threadActivity,reactions}.ts の写し（revisions:get が使う、スレッドの表示用の部品）

/** メンションしたグループの名前（ID → 名前）。消えたグループは入らない */
export async function loadGroupNames(
  db: AppContext,
  groupIds: Iterable<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of new Set(groupIds)) {
    const group = await db.groups.findById(id);
    if (group) out.set(id, group.name);
  }
  return out;
}

/** 本文の「@名前」を強調するための名前の一覧: メンションした人と、メンションしたグループ（ID は「group:ID」） */
export function mentionViews(
  userIds: readonly string[],
  groupIds: readonly string[] | undefined,
  users: ReadonlyMap<string, UserSummary>,
  groupNames: ReadonlyMap<string, string>,
): UserSummary[] {
  const out: UserSummary[] = userIds.flatMap((id) => {
    const u = users.get(id);
    return u ? [u] : [];
  });
  for (const id of groupIds ?? []) {
    const name = groupNames.get(id);
    if (name) out.push({ id: groupMentionToken(id), name, email: null });
  }
  return out;
}

/** 版の画面のスレッドに添えるやり取り（返信の件数・最後の動き・参加者・未読）。参加者は名前・メールつき */
export function activityOf(
  activity: ReadonlyMap<string, ThreadActivityView>,
  threadId: string,
  users: ReadonlyMap<string, UserSummary>,
  groupNames: ReadonlyMap<string, string> = new Map(),
) {
  const a = activity.get(threadId);
  return {
    unread: a?.unread ?? false,
    replyCount: a?.replyCount ?? 0,
    lastActivityAt: a?.lastActivityAt ?? 0,
    participantIds: a?.participantIds ?? [],
    /** 直近の返信（古い順）。投稿者の名前・メール付き */
    latestReplies: (a?.latestReplies ?? []).map((r) => ({
      ...r,
      author: users.get(r.authorId),
      mentionUsers: mentionViews(r.mentionIds, r.mentionGroupIds, users, groupNames),
    })),
    participants: (a?.participantIds ?? []).flatMap((id) => {
      const u = users.get(id);
      return u ? [u] : [];
    }),
  };
}

/** リアクションの集計（絵文字・人数・自分が付けたか・付けた人の名前） */
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
