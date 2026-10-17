import { getAuthUserId } from "@convex-dev/auth/server";
import { memberTeamIds, type Principal } from "@mf100/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { unauthenticated } from "./errors.ts";

export interface AuthenticatedUser {
  principal: Principal;
  user: Doc<"users">;
}

/**
 * 認証済み主体の解決。Convex Auth の JWT から users を引き、ドメインの Principal を組み立てる。
 * - groupIds: Nogiku Access グループ連動（後続）のための拡張点。MVP では常に空。
 * - orgPermissions: Nogiku Access の組織権限。NOGIKU_ACCESS_ENABLED=true になるまでは ["*"]（制限なし）。
 *   接続後は users.orgPermissions（ログイン時に /permission/check 等で同期）を使う。
 * - teamIds: 所属する局・担当（teams.memberIds）。非公開の制作物を担当の所属で見られる判定に使う（利用者決定 2026-10-17）。
 *   担当は高々 TEAM_MAX（300）件なので、1 回の小さな読み出しで組む。
 */
function orgPermissionsOf(user: Doc<"users">): readonly string[] {
  if (process.env.NOGIKU_ACCESS_ENABLED !== "true") return ["*"];
  return user.orgPermissions ?? [];
}

async function teamIdsOf(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<string[]> {
  const teams = await ctx.db.query("teams").collect();
  return memberTeamIds(
    teams.map((t) => ({
      id: t._id as string,
      ...(t.memberIds ? { memberIds: t.memberIds } : {}),
    })),
    userId,
  );
}

async function principalOf(ctx: QueryCtx | MutationCtx, user: Doc<"users">): Promise<Principal> {
  return {
    userId: user._id,
    isSystemAdmin: user.isSystemAdmin ?? false,
    groupIds: [],
    orgPermissions: orgPermissionsOf(user),
    teamIds: await teamIdsOf(ctx, user._id),
  };
}

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<AuthenticatedUser> {
  const userId = await getAuthUserId(ctx);
  if (!userId) unauthenticated();
  const user = await ctx.db.get(userId);
  if (!user) unauthenticated();
  return { user, principal: await principalOf(ctx, user) };
}

export async function optionalUser(ctx: QueryCtx | MutationCtx): Promise<AuthenticatedUser | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user) return null;
  return { user, principal: await principalOf(ctx, user) };
}
