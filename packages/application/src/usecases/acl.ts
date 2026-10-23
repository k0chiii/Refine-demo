import {
  DomainError,
  isGrantActive,
  type PermissionLevel,
  type Principal,
  type Work,
  type WorkPermissionGrant,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";

/**
 * 作品単位の閲覧 ACL（F-14 / U-08 / A-11 / A-19）。
 * 実施者はシステム管理者のみ。付与は人だけ（principalType は "user" 固定。グループは画面で人に展開する）。
 * 取消は revokedAt を立てる。行は消さない。
 */
export interface GrantInput {
  workId: string;
  /** 付与する人。1 人以上。重なりは 1 人。空の ID は acl_invalid。 */
  userIds: string[];
  permission: PermissionLevel;
}

export async function grantWorkPermission(
  ctx: AppContext,
  principal: Principal,
  input: GrantInput,
): Promise<WorkPermissionGrant[]> {
  if (!principal.isSystemAdmin) throw new DomainError("acl_requires_system_admin");
  const work = await ctx.works.findById(input.workId);
  if (!work) throw new DomainError("forbidden", { workId: input.workId });
  const userIds = normalizeGrantUserIds(input.userIds);
  const found = new Set((await ctx.people.profiles(userIds)).map((p) => p.id));
  const missing = userIds.filter((id) => !found.has(id));
  if (missing.length > 0)
    throw new DomainError("acl_invalid", { reason: "unknown_user", userIds: missing });

  const granted: WorkPermissionGrant[] = [];
  for (const userId of userIds)
    granted.push(await grantOne(ctx, principal, work, userId, input.permission));
  return granted;
}

async function grantOne(
  ctx: AppContext,
  principal: Principal,
  work: Work,
  userId: string,
  permission: PermissionLevel,
): Promise<WorkPermissionGrant> {
  const now = ctx.clock.now();
  for (const g of await ctx.acl.listByWork(work.id)) {
    if (!isGrantActive(g) || g.principalType !== "user" || g.principalId !== userId) continue;
    if (g.permission === permission) return g;
    const revoked = { ...g, revokedBy: principal.userId, revokedAt: now };
    await ctx.acl.update(revoked);
    await ctx.audit.record({
      entityType: "workPermission",
      entityId: work.id,
      operation: "revoke",
      actorId: principal.userId,
      before: g,
      after: revoked,
      at: now,
    });
  }
  const grant: WorkPermissionGrant = {
    workId: work.id,
    principalType: "user",
    principalId: userId,
    permission,
    grantedBy: principal.userId,
    grantedAt: now,
  };
  await ctx.acl.insert(grant);
  await ctx.audit.record({
    entityType: "workPermission",
    entityId: work.id,
    operation: "grant",
    actorId: principal.userId,
    after: grant,
    at: now,
  });
  return grant;
}

function normalizeGrantUserIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (id === "") throw new DomainError("acl_invalid", { reason: "blank_id" });
    if (!out.includes(id)) out.push(id);
  }
  if (out.length === 0) throw new DomainError("acl_invalid", { reason: "required" });
  return out;
}

export async function revokeWorkPermission(
  ctx: AppContext,
  principal: Principal,
  input: { workId: string; userId: string },
): Promise<number> {
  if (!principal.isSystemAdmin) throw new DomainError("acl_requires_system_admin");
  const work = await ctx.works.findById(input.workId);
  if (!work) throw new DomainError("forbidden", { workId: input.workId });
  const now = ctx.clock.now();
  let count = 0;
  for (const g of await ctx.acl.listByWork(work.id)) {
    if (!isGrantActive(g) || g.principalType !== "user" || g.principalId !== input.userId) continue;
    await ctx.acl.update({ ...g, revokedBy: principal.userId, revokedAt: now });
    await ctx.audit.record({
      entityType: "workPermission",
      entityId: work.id,
      operation: "revoke",
      actorId: principal.userId,
      before: g,
      at: now,
    });
    count++;
  }
  return count;
}

/** 管理者が ACL 画面で参照する（取消履歴込み）。一般ユーザーには返さない。 */
export async function listWorkPermissions(
  ctx: AppContext,
  principal: Principal,
  workId: string,
): Promise<WorkPermissionGrant[]> {
  if (!principal.isSystemAdmin) {
    // 主管・校了者は自分の作品の有効な ACL を閲覧できる
    await loadAuthorizedWork(ctx, principal, workId, "audit.view");
    return (await ctx.acl.listByWork(workId)).filter(isGrantActive);
  }
  return ctx.acl.listByWork(workId);
}
