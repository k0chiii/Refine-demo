import { allMembersCanView, canViewWork, workTeamIdsOf } from "../acl/authorize.ts";
import { isGrantActive, type WorkPermissionGrant } from "../acl/Permission.ts";
import { memberTeamIds, type Team } from "../org/team.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { Work } from "../work/Work.ts";

/** 1 つのコメント・返信でメンションできる人数の上限（通知の大量送信を防ぐ） */
export const MENTION_MAX = 10;

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
    work.approverId,
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
