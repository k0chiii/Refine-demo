import { grantWorkPermission, listWorkPermissions, revokeWorkPermission } from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase, unauthenticated } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { resolveUsers } from "./lib/users.ts";
import { vPermissionLevel, vPrincipalType } from "./lib/validators.ts";

/** 作品の閲覧 ACL 付与（U-08 / A-19）。システム管理者のみ。 */
export const grant = mutation({
  args: {
    workId: v.id("works"),
    principalType: vPrincipalType,
    principalId: v.string(),
    permission: vPermissionLevel,
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await grantWorkPermission(createAppContext(ctx.db), principal, args);
      return null;
    });
  },
});

export const revoke = mutation({
  args: { workId: v.id("works"), principalType: vPrincipalType, principalId: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => revokeWorkPermission(createAppContext(ctx.db), principal, args));
  },
});

/** ACL 一覧（履歴込み）。管理者は全履歴、主管・校了者は有効分のみ。 */
export const list = query({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const grants = await listWorkPermissions(createReadContext(ctx.db), principal, workId);
      const users = await resolveUsers(
        ctx.db,
        grants.flatMap((g) => [g.principalId, g.grantedBy, ...(g.revokedBy ? [g.revokedBy] : [])]),
      );
      return grants
        .map((g) => ({
          ...g,
          principal: users.get(g.principalId),
          granter: users.get(g.grantedBy),
          revoker: g.revokedBy ? users.get(g.revokedBy) : null,
        }))
        .sort((a, b) => b.grantedAt - a.grantedAt);
    });
  },
});

/**
 * ACL 付与対象の検索。MVP の制約: Nogiku のユーザー一覧 API は使わず、
 * 一度でもこのシステムにログインした Nogiku ユーザーのみ候補になる（Nogiku Access の users.read 連携は後続）。
 */
export const searchUsers = query({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const { principal } = await requireUser(ctx);
    if (!principal.isSystemAdmin) unauthenticated();
    const q = text.trim().toLowerCase();
    const users = await ctx.db.query("users").take(500);
    return users
      .filter((u) => u.nogikuSubject !== undefined)
      .filter((u) => q === "" || `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(q))
      .slice(0, 20)
      .map((u) => ({
        id: u._id,
        name: u.name ?? "",
        email: u.email ?? null,
        isSystemAdmin: u.isSystemAdmin ?? false,
      }));
  },
});
