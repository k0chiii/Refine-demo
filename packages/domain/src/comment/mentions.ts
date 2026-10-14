import { canViewWork } from "../acl/authorize.ts";
import { isGrantActive, type WorkPermissionGrant } from "../acl/Permission.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { Work } from "../work/Work.ts";

/** 1 つのコメント・返信でメンションできる人数の上限（通知の大量送信を防ぐ） */
export const MENTION_MAX = 10;

/**
 * メンションできる人: その制作物を見られる人（制作者・主管担当・校了権限者・有効な閲覧以上の ACL）。
 * システム管理者は内容を見ないので（D3）、職責か ACL が無ければ含めない。
 */
export function mentionableUserIds(work: Work, grants: readonly WorkPermissionGrant[]): string[] {
  const ids = new Set<string>([...work.creatorIds, ...work.managerIds, work.approverId]);
  for (const g of grants)
    if (g.principalType === "user" && isGrantActive(g)) ids.add(g.principalId);
  return [...ids].filter((userId) =>
    canViewWork({
      work,
      grants,
      principal: { userId, isSystemAdmin: false, groupIds: [], orgPermissions: [] },
    }),
  );
}

/**
 * メンションの検査: 重複を除き、上限を超えたら mention_too_many、
 * 制作物を見られない人が含まれていたら mention_not_allowed（見られない人に内容を通知しない）。
 */
export function validateMentions(
  mentions: readonly string[] | undefined,
  work: Work,
  grants: readonly WorkPermissionGrant[],
): string[] {
  const ids = [...new Set(mentions ?? [])];
  if (ids.length > MENTION_MAX)
    throw new DomainError("mention_too_many", { count: ids.length, max: MENTION_MAX });
  const allowed = new Set(mentionableUserIds(work, grants));
  for (const id of ids)
    if (!allowed.has(id)) throw new DomainError("mention_not_allowed", { userId: id });
  return ids;
}
