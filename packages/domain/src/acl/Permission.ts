import type { GroupId, UserId, WorkId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";

/**
 * 作品単位の閲覧 ACL（C10 / F-14 / D3）。
 * MVP では principalType = "user" のみ有効化する。"group" は Nogiku Access グループ連動（後続）のために予約。
 */
export type PrincipalType = "user" | "group";

/** 権限レベルは包含関係を持つ: manage ⊃ edit ⊃ review ⊃ view */
export const permissionLevels = ["view", "review", "edit", "manage"] as const;
export type PermissionLevel = (typeof permissionLevels)[number];

const levelRank: Record<PermissionLevel, number> = { view: 0, review: 1, edit: 2, manage: 3 };

export function permissionIncludes(granted: PermissionLevel, required: PermissionLevel): boolean {
  return levelRank[granted] >= levelRank[required];
}

export interface WorkPermissionGrant {
  workId: WorkId;
  principalType: PrincipalType;
  principalId: UserId;
  permission: PermissionLevel;
  grantedBy: UserId;
  grantedAt: Instant;
  revokedBy?: UserId;
  revokedAt?: Instant;
}

export function isGrantActive(grant: WorkPermissionGrant): boolean {
  return grant.revokedAt === undefined;
}

/** 認可対象の主体。groupIds は将来 Nogiku Access から供給される（MVP では常に空）。 */
export interface Principal {
  userId: UserId;
  /** 校正システム管理者（ACL 設定・運用）。業務上の校了権限を意味しない（§2.1, §5.2-12）。 */
  isSystemAdmin: boolean;
  groupIds: readonly GroupId[];
}

/** 主体に有効な最大権限レベルを求める。該当なしは null。 */
export function effectivePermission(
  grants: readonly WorkPermissionGrant[],
  principal: Principal,
): PermissionLevel | null {
  let best: PermissionLevel | null = null;
  for (const grant of grants) {
    if (!isGrantActive(grant)) continue;
    const matches =
      (grant.principalType === "user" && grant.principalId === principal.userId) ||
      (grant.principalType === "group" && principal.groupIds.includes(grant.principalId));
    if (!matches) continue;
    if (best === null || levelRank[grant.permission] > levelRank[best]) best = grant.permission;
  }
  return best;
}
