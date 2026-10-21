import { allMembersCanView, canViewWork, workTeamIdsOf } from "../acl/authorize.ts";
import { isGrantActive, type WorkPermissionGrant } from "../acl/Permission.ts";
import { expandMemberGroups, type MemberGroup } from "../org/group.ts";
import { memberTeamIds, type Team } from "../org/team.ts";
import { DomainError } from "../shared/DomainError.ts";
import { approversOf } from "../work/approvers.ts";
import type { Work } from "../work/Work.ts";

/** 1 つのコメント・返信でメンションできる人数の上限（通知の大量送信を防ぐ。グループで知らせる人は数えない） */
export const MENTION_MAX = 10;
/** 1 つのコメント・返信でメンションできるグループの数の上限（ポリシー値） */
export const MENTION_GROUP_MAX = 3;
/**
 * メンションの書き方のうち、グループを指すもの（「group:」＋グループの ID）。人の ID（Convex の users の ID）とは紛れない。
 * 画面の入力欄はグループを選ぶとこの形で送り、サーバーが所属する人に広げる（{@link resolveGroupMentions}）
 */
export const MENTION_GROUP_PREFIX = "group:";

export const groupMentionToken = (groupId: string) => `${MENTION_GROUP_PREFIX}${groupId}`;

/** 送られたメンションを、人の ID とグループの ID に分ける（重なりは除く） */
export function splitMentionTokens(mentions: readonly string[] | undefined): {
  userIds: string[];
  groupIds: string[];
} {
  const userIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const m of mentions ?? []) {
    if (m.startsWith(MENTION_GROUP_PREFIX)) {
      const id = m.slice(MENTION_GROUP_PREFIX.length).trim();
      if (id !== "") groupIds.add(id);
    } else userIds.add(m);
  }
  return { userIds: [...userIds], groupIds: [...groupIds] };
}

/** 所属の判定に要る担当の項目（Team の部分） */
export type TeamMembership = Pick<Team, "id" | "memberIds">;

/**
 * 制作物に関わっていてメンションできる人: 制作者・主管・校了権限者・有効な閲覧以上の ACL を持つ人・関係者・
 * 主管担当／制作担当／関係担当に所属する人（利用者決定 2026-10-17）のうち、その制作物を見られる人。
 * システム管理者は内容を見ないので（D3）、職責か ACL が無ければ含めない。
 * 通常の制作物を委員の誰でも見られる設定（WorkViewPolicy）では、候補はこれに限らず委員全員になる
 * （名簿を引くのはアプリケーション層。{@link validateMentions} も同じ）。
 */
export function mentionableUserIds(
  work: Work,
  grants: readonly WorkPermissionGrant[],
  teams: readonly TeamMembership[] = [],
): string[] {
  const ids = new Set<string>([
    ...work.creatorIds,
    ...work.managerIds,
    ...approversOf(work),
    ...(work.stakeholderIds ?? []),
  ]);
  for (const g of grants)
    if (g.principalType === "user" && isGrantActive(g)) ids.add(g.principalId);
  const workTeams = new Set(workTeamIdsOf(work));
  for (const t of teams) if (workTeams.has(t.id)) for (const id of t.memberIds ?? []) ids.add(id);
  return [...ids].filter((userId) =>
    canViewWork({
      work,
      grants,
      principal: {
        userId,
        isSystemAdmin: false,
        groupIds: [],
        orgPermissions: [],
        teamIds: memberTeamIds(teams, userId),
      },
    }),
  );
}

/**
 * メンションの検査: 重複を除き、上限を超えたら mention_too_many、
 * 制作物を見られない人が含まれていたら mention_not_allowed（見られない人に内容を通知しない）。
 * 通常の制作物を委員の誰でも見られる設定では、委員かどうか（名簿）だけが条件なので、ここでは上限と重複だけを見る。
 */
export function validateMentions(
  mentions: readonly string[] | undefined,
  work: Work,
  grants: readonly WorkPermissionGrant[],
  teams: readonly TeamMembership[] = [],
): string[] {
  const ids = [...new Set(mentions ?? [])];
  if (ids.length > MENTION_MAX)
    throw new DomainError("mention_too_many", { count: ids.length, max: MENTION_MAX });
  if (allMembersCanView(work)) return ids;
  const allowed = new Set(mentionableUserIds(work, grants, teams));
  for (const id of ids)
    if (!allowed.has(id)) throw new DomainError("mention_not_allowed", { userId: id });
  return ids;
}

/**
 * グループのメンションを、知らせる人に広げる（利用者指示 2026-10-21）。
 * - グループは {@link MENTION_GROUP_MAX} まで。知らないグループは mention_not_allowed（groupId）
 * - 所属する人のうち、その制作物を見られる人だけに知らせる（見られない人は黙って外す。グループの中身は書く人が決められないので
 *   投稿を止めない）。通常の制作物を委員の誰でも見られる設定では、所属する人全員（名簿の確認はアプリケーション層）
 * - 書いた本人も外す（自分には知らせない）
 */
export function resolveGroupMentions(
  groupIds: readonly string[],
  groups: readonly Pick<MemberGroup, "id" | "memberIds">[],
  work: Work,
  grants: readonly WorkPermissionGrant[],
  teams: readonly TeamMembership[] = [],
  authorId?: string,
): string[] {
  const ids = [...new Set(groupIds)];
  if (ids.length > MENTION_GROUP_MAX)
    throw new DomainError("mention_too_many", { groups: ids.length, max: MENTION_GROUP_MAX });
  const known = new Set(groups.map((g) => g.id));
  for (const id of ids)
    if (!known.has(id)) throw new DomainError("mention_not_allowed", { groupId: id });
  const members = expandMemberGroups(ids, groups).filter((id) => id !== authorId);
  if (allMembersCanView(work)) return members;
  const allowed = new Set(mentionableUserIds(work, grants, teams));
  return members.filter((id) => allowed.has(id));
}
