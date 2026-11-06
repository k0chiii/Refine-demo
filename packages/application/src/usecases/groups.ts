import {
  canManageGroups,
  DomainError,
  MEMBER_GROUP_MAX,
  orgPermissions,
  sortMemberGroups,
  validateMemberGroup,
  type MemberGroup,
  type MemberGroupInput,
  type Principal,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";

/**
 * メンバーのグループ（利用者指示 2026-10-21）。校正者の割り当てとメンションで、所属する人をまとめて選ぶ。
 * 作る・変える・消すのは組織権限 groups:manage を持つ人とシステム管理者（利用者指示 2026-10-29）。
 * 一覧はサインインしていれば誰でも（選ぶ画面で使う）。
 */
export async function listMemberGroups(
  ctx: AppContext,
  _principal: Principal,
): Promise<MemberGroup[]> {
  return sortMemberGroups(await ctx.groups.list());
}

function requireGroupsManage(principal: Principal): void {
  if (!canManageGroups(principal))
    throw new DomainError("forbidden", { orgPermission: orgPermissions.groupsManage });
}

/** 所属する人が委員の名簿にいるか。既にいた人は確かめ直さない（担当の所属と同じ） */
async function assertMembersExist(
  ctx: AppContext,
  after: readonly string[],
  before: readonly string[],
): Promise<void> {
  const known = new Set(before);
  const ids = after.filter((id) => !known.has(id));
  if (ids.length === 0) return;
  const found = new Set((await ctx.people.profiles(ids)).map((p) => p.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0)
    throw new DomainError("group_invalid", {
      field: "memberIds",
      reason: "unknown_user",
      userIds: missing,
    });
}

export async function saveMemberGroup(
  ctx: AppContext,
  principal: Principal,
  input: MemberGroupInput & { id?: string },
): Promise<MemberGroup> {
  requireGroupsManage(principal);
  const { id, ...rest } = input;
  const all = await ctx.groups.list();
  const now = ctx.clock.now();
  if (id) {
    const before = all.find((g) => g.id === id) ?? (await ctx.groups.findById(id));
    if (!before) throw new DomainError("group_not_found", { groupId: id });
    // 並び順を省略したら今のまま
    const clean = validateMemberGroup({ ...rest, order: rest.order ?? before.order }, all, id);
    await assertMembersExist(ctx, clean.memberIds, before.memberIds);
    const next: MemberGroup = { id, ...clean, updatedAt: now, updatedBy: principal.userId };
    await ctx.groups.update(next);
    await ctx.audit.record({
      entityType: "memberGroup",
      entityId: id,
      operation: "update",
      actorId: principal.userId,
      before,
      after: next,
      at: now,
    });
    return next;
  }
  if (all.length >= MEMBER_GROUP_MAX)
    throw new DomainError("group_invalid", { reason: "limit", max: MEMBER_GROUP_MAX });
  const clean = validateMemberGroup(rest, all);
  await assertMembersExist(ctx, clean.memberIds, []);
  const created = await ctx.groups.insert({
    ...clean,
    updatedAt: now,
    updatedBy: principal.userId,
  });
  await ctx.audit.record({
    entityType: "memberGroup",
    entityId: created.id,
    operation: "create",
    actorId: principal.userId,
    after: created,
    at: now,
  });
  return created;
}

/**
 * 削除。校正者の割り当ては人ごとに残っているので、グループを消しても割り当ては変わらない。
 * 過去のコメントの「@グループ名」は強調されなくなるだけ（知らせた人は mentions に残っている）
 */
export async function deleteMemberGroup(
  ctx: AppContext,
  principal: Principal,
  id: string,
): Promise<void> {
  requireGroupsManage(principal);
  const before = await ctx.groups.findById(id);
  if (!before) return;
  await ctx.groups.remove(id);
  await ctx.audit.record({
    entityType: "memberGroup",
    entityId: id,
    operation: "delete",
    actorId: principal.userId,
    before,
    at: ctx.clock.now(),
  });
}
