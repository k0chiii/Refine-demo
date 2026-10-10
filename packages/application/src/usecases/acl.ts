import { DomainError, isGrantActive, type PermissionLevel, type Principal, type PrincipalType, type WorkPermissionGrant } from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";

/**
 * 作品単位の閲覧 ACL 管理（F-14 / U-08 / A-11 / A-19）。
 * - 実施者は校正システム管理者のみ（職責ではなく principal.isSystemAdmin）。
 * - MVP では principalType = "user"（Nogiku ユーザー）のみ。group は後続機能のため拒否する。
 * - 付与・取消はすべて履歴として残す（取消は revokedAt を立てる。削除しない）。
 */
export interface GrantInput {
  workId: string;
  principalType: PrincipalType;
  principalId: string;
  permission: PermissionLevel;
}

export async function grantWorkPermission(ctx: AppContext, principal: Principal, input: GrantInput): Promise<WorkPermissionGrant> {
  if (!principal.isSystemAdmin) throw new DomainError("acl_requires_system_admin");
  if (input.principalType !== "user") throw new DomainError("acl_group_principal_not_enabled", { principalType: input.principalType });
  const work = await ctx.works.findById(input.workId);
  if (!work) throw new DomainError("forbidden", { workId: input.workId });

  const now = ctx.clock.now();
  const grants = await ctx.acl.listByWork(work.id);
  // 同一主体の有効な付与は 1 件に正規化する（レベル変更 = 旧付与を取消して新付与）。
  for (const g of grants) {
    if (isGrantActive(g) && g.principalType === input.principalType && g.principalId === input.principalId) {
      if (g.permission === input.permission) return g;
      const revoked = { ...g, revokedBy: principal.userId, revokedAt: now };
      await ctx.acl.update(revoked);
      await ctx.audit.record({ entityType: "workPermission", entityId: work.id, operation: "revoke", actorId: principal.userId, before: g, after: revoked, at: now });
    }
  }
  const grant: WorkPermissionGrant = {
    workId: work.id,
    principalType: input.principalType,
    principalId: input.principalId,
    permission: input.permission,
    grantedBy: principal.userId,
    grantedAt: now,
  };
  await ctx.acl.insert(grant);
  await ctx.audit.record({ entityType: "workPermission", entityId: work.id, operation: "grant", actorId: principal.userId, after: grant, at: now });
  return grant;
}

export async function revokeWorkPermission(
  ctx: AppContext,
  principal: Principal,
  input: { workId: string; principalType: PrincipalType; principalId: string },
): Promise<number> {
  if (!principal.isSystemAdmin) throw new DomainError("acl_requires_system_admin");
  const work = await ctx.works.findById(input.workId);
  if (!work) throw new DomainError("forbidden", { workId: input.workId });
  const now = ctx.clock.now();
  let count = 0;
  for (const g of await ctx.acl.listByWork(work.id)) {
    if (!isGrantActive(g) || g.principalType !== input.principalType || g.principalId !== input.principalId) continue;
    await ctx.acl.update({ ...g, revokedBy: principal.userId, revokedAt: now });
    await ctx.audit.record({ entityType: "workPermission", entityId: work.id, operation: "revoke", actorId: principal.userId, before: g, at: now });
    count++;
  }
  return count;
}

/** 管理者が ACL 画面で参照する（取消履歴込み）。一般ユーザーには返さない。 */
export async function listWorkPermissions(ctx: AppContext, principal: Principal, workId: string): Promise<WorkPermissionGrant[]> {
  if (!principal.isSystemAdmin) {
    // 主管・校了者は自分の作品の有効な ACL を閲覧できる
    await loadAuthorizedWork(ctx, principal, workId, "audit.view");
    return (await ctx.acl.listByWork(workId)).filter(isGrantActive);
  }
  return ctx.acl.listByWork(workId);
}
