import type { ThreadActivityView } from "@mf100/application";
import type { UserSummary } from "./users.ts";

/**
 * 版の画面のスレッドに添えるやり取り（返信の件数・最後の動き・参加者・未読）。
 * 参加者は名前・メールつき（一覧のアバター）。スレッドが持つ生の項目（participantIds など）はこれで上書きする
 */
export function activityOf(
  activity: ReadonlyMap<string, ThreadActivityView>,
  threadId: string,
  users: ReadonlyMap<string, UserSummary>,
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
      mentionUsers: r.mentionIds.flatMap((id) => {
        const u = users.get(id);
        return u ? [u] : [];
      }),
    })),
    participants: (a?.participantIds ?? []).flatMap((id) => {
      const u = users.get(id);
      return u ? [u] : [];
    }),
  };
}
