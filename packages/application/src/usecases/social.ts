import {
  DomainError,
  SOCIAL_PROFILE_MAX,
  validateSocialProfile,
  type Principal,
  type SocialProfile,
  type SocialProfileInput,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";

/**
 * SNS のアカウント（本体の設定）。登録・変更・削除はシステム管理者だけ。
 * 一覧は誰でも見られる（公開アカウントの見た目だけで、ログイン情報は持たない）。制作物への割り当ては制作物の編集権限で行う（updateWork）。
 */
export async function listSocialProfiles(
  ctx: AppContext,
  _principal: Principal,
): Promise<SocialProfile[]> {
  const list = await ctx.socialProfiles.list();
  return list.sort(
    (a, b) => a.platform.localeCompare(b.platform) || a.username.localeCompare(b.username),
  );
}

export async function saveSocialProfile(
  ctx: AppContext,
  principal: Principal,
  input: SocialProfileInput & { id?: string },
): Promise<SocialProfile> {
  if (!principal.isSystemAdmin) throw new DomainError("forbidden", { reason: "system_admin_only" });
  const { id, ...rest } = input;
  const clean = validateSocialProfile(rest);
  const now = ctx.clock.now();
  if (id) {
    const before = await ctx.socialProfiles.findById(id);
    if (!before) throw new DomainError("forbidden", { socialProfileId: id });
    const next: SocialProfile = { id, ...clean, updatedAt: now, updatedBy: principal.userId };
    await ctx.socialProfiles.update(next);
    await ctx.audit.record({
      entityType: "socialProfile",
      entityId: id,
      operation: "update",
      actorId: principal.userId,
      before,
      after: next,
      at: now,
    });
    return next;
  }
  if ((await ctx.socialProfiles.list()).length >= SOCIAL_PROFILE_MAX)
    throw new DomainError("social_profile_limit", { max: SOCIAL_PROFILE_MAX });
  const created = await ctx.socialProfiles.insert({
    ...clean,
    updatedAt: now,
    updatedBy: principal.userId,
  });
  await ctx.audit.record({
    entityType: "socialProfile",
    entityId: created.id,
    operation: "create",
    actorId: principal.userId,
    after: created,
    at: now,
  });
  return created;
}

export async function deleteSocialProfile(
  ctx: AppContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!principal.isSystemAdmin) throw new DomainError("forbidden", { reason: "system_admin_only" });
  const before = await ctx.socialProfiles.findById(id);
  if (!before) return;
  const used = await ctx.socialProfiles.countWorksUsing(id);
  if (used > 0)
    throw new DomainError("social_profile_in_use", { socialProfileId: id, works: used });
  await ctx.socialProfiles.remove(id);
  await ctx.audit.record({
    entityType: "socialProfile",
    entityId: id,
    operation: "delete",
    actorId: principal.userId,
    before,
    at: ctx.clock.now(),
  });
}
