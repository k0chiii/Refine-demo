import { getAuthUserId } from "@convex-dev/auth/server";
import type { Principal } from "@mf100/domain";
import type { Doc } from "../_generated/dataModel";
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
 */
function orgPermissionsOf(user: Doc<"users">): readonly string[] {
  if (process.env.NOGIKU_ACCESS_ENABLED !== "true") return ["*"];
  return user.orgPermissions ?? [];
}

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<AuthenticatedUser> {
  const userId = await getAuthUserId(ctx);
  if (!userId) unauthenticated();
  const user = await ctx.db.get(userId);
  if (!user) unauthenticated();
  return {
    user,
    principal: {
      userId: user._id,
      isSystemAdmin: user.isSystemAdmin ?? false,
      groupIds: [],
      orgPermissions: orgPermissionsOf(user),
    },
  };
}

export async function optionalUser(ctx: QueryCtx | MutationCtx): Promise<AuthenticatedUser | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user) return null;
  return {
    user,
    principal: {
      userId: user._id,
      isSystemAdmin: user.isSystemAdmin ?? false,
      groupIds: [],
      orgPermissions: orgPermissionsOf(user),
    },
  };
}
