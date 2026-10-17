import { getAuthUserId } from "@convex-dev/auth/server";
import { memberTeamIds, type Principal } from "@mf100/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader, MutationCtx, QueryCtx } from "../_generated/server";
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
 * - teamIds: 所属する局・担当（teams.memberIds）は**ここでは組まない**（undefined）。毎回 teams を全件読むと、どのクエリの
 *   読み集合にも teams が入り、担当の編集のたびに全画面の購読が再実行されるため（docs/UI_M3E.md §60）。所属が効くのは
 *   非公開・取扱注意の制作物の閲覧の判定だけなので、要るところ（application の withTeamMembership・works.listMyWorks）が
 *   {@link teamIdsOf} で読んで添える（利用者決定 2026-10-17 の「所属する人は見られる」はそのまま）。
 */
function orgPermissionsOf(user: Doc<"users">): readonly string[] {
  if (process.env.NOGIKU_ACCESS_ENABLED !== "true") return ["*"];
  return user.orgPermissions ?? [];
}

/** その人が所属する局・担当の ID（teams.memberIds。高々 TEAM_MAX 件の小さな読み出し）。要るときだけ呼ぶ */
export async function teamIdsOf(db: DatabaseReader, userId: Id<"users">): Promise<string[]> {
  const teams = await db.query("teams").take(1000);
  return memberTeamIds(
    teams.map((t) => ({
      id: t._id as string,
      ...(t.memberIds ? { memberIds: t.memberIds } : {}),
    })),
    userId,
  );
}

function principalOf(user: Doc<"users">): Principal {
  return {
    userId: user._id,
    isSystemAdmin: user.isSystemAdmin ?? false,
    groupIds: [],
    orgPermissions: orgPermissionsOf(user),
  };
}

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<AuthenticatedUser> {
  const userId = await getAuthUserId(ctx);
  if (!userId) unauthenticated();
  const user = await ctx.db.get(userId);
  if (!user) unauthenticated();
  return { user, principal: principalOf(user) };
}

export async function optionalUser(ctx: QueryCtx | MutationCtx): Promise<AuthenticatedUser | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user) return null;
  return { user, principal: principalOf(user) };
}
