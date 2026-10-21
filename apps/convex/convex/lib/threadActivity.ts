import type { ThreadActivityView } from "@mf100/application";
import { groupMentionToken } from "@mf100/domain";
import type { DatabaseReader } from "../_generated/server";
import type { UserSummary } from "./users.ts";

/** メンションしたグループの名前（ID → 名前）。グループのメンションが無ければ読まない。消えたグループは入らない */
export async function loadGroupNames(
  db: DatabaseReader,
  groupIds: Iterable<string>,
): Promise<Map<string, string>> {
  const wanted = new Set(groupIds);
  if (wanted.size === 0) return new Map();
  const groups = await db.query("memberGroups").take(1000);
  return new Map(groups.filter((g) => wanted.has(g._id)).map((g) => [g._id as string, g.name]));
}

/**
 * 本文の「@名前」を強調するための名前の一覧: メンションした人と、メンションしたグループ（ID は「group:ID」）。
 * 知らない人・消えたグループは出さない
 */
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

/**
 * 版の画面のスレッドに添えるやり取り（返信の件数・最後の動き・参加者・未読）。
 * 参加者は名前・メールつき（一覧のアバター）。スレッドが持つ生の項目（participantIds など）はこれで上書きする
 */
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
