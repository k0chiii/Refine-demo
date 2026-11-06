import { grantWorkPermission, listWorkPermissions, revokeWorkPermission } from "@mf100/application";
import { personMatchesText, type Work } from "@mf100/domain";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { requireAdmin, resolveUsers, takeUsers, userDisplayName } from "./users.ts";
import { object, vId, vPermissionLevel } from "./validators.ts";

// apps/convex/convex/acl.ts の写し

export const acl = {
  /** ACL 一覧（履歴込み）。管理者は全履歴、主管・校了者は有効分のみ。新しい付与が先 */
  "acl:list": query({
    auth: "user",
    args: object({ workId: z.string() }),
    handler: async (ctx, { workId }) => {
      const grants = await listWorkPermissions(ctx.db, ctx.principal!, workId);
      const users = resolveUsers(
        ctx.sql,
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
    },
  }),

  /**
   * ACL 付与対象の検索。MVP の制約: Nogiku のユーザー一覧 API は使わず、
   * 一度でもこのシステムにログインした人（subject がある）のみ候補になる。管理者のみ
   */
  "acl:searchUsers": query({
    auth: "user",
    args: object({ text: z.string() }),
    handler: async (ctx, { text }) => {
      requireAdmin(ctx);
      return takeUsers(ctx.sql, 500)
        .filter((u) => u.subject !== undefined)
        .filter((u) => personMatchesText(u, text))
        .slice(0, 20)
        .map((u) => ({
          id: u.id,
          name: userDisplayName(u),
          email: u.email ?? null,
          isSystemAdmin: u.isSystemAdmin ?? false,
          /** 代（Notion のユーザ DB「代」） */
          generation: u.generation ?? null,
        }));
    },
  }),

  /**
   * ACL 管理のための作品メタ情報（管理者のみ）。管理者は作品の内容（版・添付・指摘）を当然には閲覧できないが（§7.2）、
   * 閲覧者を調整するには対象作品を特定できる必要がある。返すのは名称・旧ID・区分・状態のみ
   */
  "acl:workSummary": query({
    auth: "user",
    args: object({ workId: vId }),
    handler: async (ctx, { workId }) => {
      requireAdmin(ctx);
      const work = await ctx.db.works.findById(workId);
      if (!work) return null;
      return {
        id: work.id,
        title: work.title,
        legacyId: work.legacyId ?? null,
        category: work.category,
        lifecycle: work.lifecycle,
      };
    },
  }),

  /** 管理画面の制作物の一覧（新しい順に 500 件）と、有効な付与の数。管理者のみ */
  "acl:adminWorks": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => {
      requireAdmin(ctx);
      const works = ctx.sql
        .exec("SELECT doc FROM works ORDER BY rowid DESC LIMIT 500")
        .map((r) => JSON.parse(r.doc as string) as Work);
      const active = new Map(
        ctx.sql
          .exec(
            "SELECT workId, count(*) AS n FROM grants WHERE json_extract(doc, '$.revokedAt') IS NULL GROUP BY workId",
          )
          .map((r) => [r.workId as string, Number(r.n)]),
      );
      return works.map((w) => ({
        id: w.id,
        title: w.title,
        legacyId: w.legacyId ?? null,
        category: w.category,
        mediaType: w.mediaType,
        lifecycle: w.lifecycle,
        activeGrantCount: active.get(w.id) ?? 0,
      }));
    },
  }),

  /** 作品の閲覧 ACL 付与（U-08 / A-19）。システム管理者のみ */
  "acl:grant": mutation({
    auth: "user",
    args: object({ workId: vId, userIds: z.array(vId), permission: vPermissionLevel }),
    handler: async (ctx, args) => {
      await grantWorkPermission(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  "acl:revoke": mutation({
    auth: "user",
    args: object({ workId: vId, userId: vId }),
    handler: async (ctx, args) => revokeWorkPermission(ctx.db, ctx.principal!, args),
  }),
} satisfies Record<string, FnDef>;
