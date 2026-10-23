import { grantWorkPermission, listWorkPermissions, revokeWorkPermission } from "@mf100/application";
import { personMatchesText } from "@mf100/domain";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase, unauthenticated } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { resolveUsers, userDisplayName } from "./lib/users.ts";
import { vPermissionLevel } from "./lib/validators.ts";

/** 作品の閲覧 ACL 付与（U-08 / A-19）。システム管理者のみ。 */
export const grant = mutation({
  args: {
    workId: v.id("works"),
    userIds: v.array(v.id("users")),
    permission: vPermissionLevel,
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await grantWorkPermission(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

export const revoke = mutation({
  args: { workId: v.id("works"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => revokeWorkPermission(createAppContext(ctx), principal, args));
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
    const users = await ctx.db.query("users").take(500);
    return users
      .filter((u) => u.nogikuSubject !== undefined)
      .filter((u) => personMatchesText(u, text))
      .slice(0, 20)
      .map((u) => ({
        id: u._id,
        name: userDisplayName(u),
        email: u.email ?? null,
        isSystemAdmin: u.isSystemAdmin ?? false,
        /** 代（Notion のユーザ DB「代」） */
        generation: u.generation ?? null,
      }));
  },
});

/**
 * ACL 管理のための作品メタ情報（管理者のみ）。
 * 管理者は作品の内容（版・添付・指摘）を当然には閲覧できないが（§7.2）、閲覧者を調整するには対象作品を特定できる必要がある。
 * 返すのは名称・旧ID・区分・状態のみ。
 */
export const workSummary = query({
  args: { workId: v.id("works") },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    if (!principal.isSystemAdmin) unauthenticated();
    const work = await ctx.db.get("works", workId);
    if (!work) return null;
    return {
      id: work._id,
      title: work.title,
      legacyId: work.legacyId ?? null,
      category: work.category,
      lifecycle: work.lifecycle,
      confidentiality: work.confidentiality,
    };
  },
});

export const adminWorks = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    if (!principal.isSystemAdmin) unauthenticated();
    const works = await ctx.db.query("works").order("desc").take(500);
    const out = [];
    for (const w of works) {
      const grants = await ctx.db
        .query("workPermissions")
        .withIndex("by_work", (q) => q.eq("workId", w._id))
        .collect();
      out.push({
        id: w._id,
        title: w.title,
        legacyId: w.legacyId ?? null,
        category: w.category,
        lifecycle: w.lifecycle,
        confidentiality: w.confidentiality,
        activeGrantCount: grants.filter((g) => g.revokedAt === undefined).length,
      });
    }
    return out;
  },
});
