import { exportWorkStats } from "@mf100/application";
import { z } from "zod";
import { mutation, query, reject, type FnDef } from "./define.ts";
import { requireAdmin } from "./users.ts";
import { object } from "./validators.ts";

// apps/convex/convex/admin.ts の写し

export const admin = {
  /** 校正システム管理者の付与・剥奪。管理者のみ。自分自身の剥奪は最後の一人なら拒否する */
  "admin:setSystemAdmin": mutation({
    auth: "user",
    args: object({ userId: z.string(), value: z.boolean() }),
    handler: async (ctx, { userId, value }) => {
      requireAdmin(ctx);
      const [before] = ctx.sql.exec(
        "SELECT json_extract(doc, '$.isSystemAdmin') AS admin FROM users WHERE id = ?",
        userId,
      );
      if (!before) throw reject("user_not_found", { userId });
      if (!value && userId === ctx.principal!.userId) {
        const [admins] = ctx.sql.exec(
          "SELECT count(*) AS n FROM users WHERE json_extract(doc, '$.isSystemAdmin') = 1",
        );
        if (Number(admins?.n) <= 1) throw reject("last_system_admin");
      }
      ctx.sql.exec(
        "UPDATE users SET doc = json_set(doc, '$.isSystemAdmin', json(?)) WHERE id = ?",
        value ? "true" : "false",
        userId,
      );
      await ctx.db.audit.record({
        entityType: "user",
        entityId: userId,
        operation: value ? "grant_system_admin" : "revoke_system_admin",
        actorId: ctx.principal!.userId,
        before: before.admin === 1,
        after: value,
        at: ctx.now(),
      });
      return null;
    },
  }),

  /**
   * 代（Notion のユーザ DB「代」。例: 100）を付ける。管理者のみ。null で消す。
   * 認証（Nogiku）には触れない。名簿の連携ができるまでは管理者が手で付ける（docs/NOTION_ALIGNMENT.md）
   */
  "admin:setGeneration": mutation({
    auth: "user",
    args: object({ userId: z.string(), generation: z.number().nullable() }),
    handler: async (ctx, { userId, generation }) => {
      requireAdmin(ctx);
      if (
        generation !== null &&
        (!Number.isInteger(generation) || generation < 1 || generation > 999)
      )
        throw reject("generation_invalid", { generation });
      const [before] = ctx.sql.exec(
        "SELECT json_extract(doc, '$.generation') AS generation FROM users WHERE id = ?",
        userId,
      );
      if (!before) throw reject("user_not_found", { userId });
      if (generation === null)
        ctx.sql.exec(
          "UPDATE users SET doc = json_remove(doc, '$.generation') WHERE id = ?",
          userId,
        );
      else
        ctx.sql.exec(
          "UPDATE users SET doc = json_set(doc, '$.generation', ?) WHERE id = ?",
          generation,
          userId,
        );
      await ctx.db.audit.record({
        entityType: "user",
        entityId: userId,
        operation: "set_generation",
        actorId: ctx.principal!.userId,
        before: (before.generation as number | null) ?? null,
        after: generation,
        at: ctx.now(),
      });
      return null;
    },
  }),

  /**
   * 監査ログ（F-13）。管理者のみ。新しい順。entityType と entityId を両方渡したときだけ絞る（Convex と同じ）。
   * _id は行の連番（画面が key に使う）
   * ponytail: audit は列も index も持たないので、絞りは全件の json_extract。件数が増えたら cols を足す
   */
  "admin:auditLog": query({
    auth: "user",
    args: object({
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      limit: z.number().optional(),
    }),
    handler: async (ctx, args) => {
      requireAdmin(ctx);
      const limit = Math.max(0, Math.min(args.limit ?? 100, 500));
      const rows =
        args.entityType && args.entityId
          ? ctx.sql.exec(
              "SELECT rowid AS rid, doc FROM audit WHERE json_extract(doc, '$.entityType') = ? AND json_extract(doc, '$.entityId') = ? ORDER BY rowid DESC LIMIT ?",
              args.entityType,
              args.entityId,
              limit,
            )
          : ctx.sql.exec("SELECT rowid AS rid, doc FROM audit ORDER BY rowid DESC LIMIT ?", limit);
      return rows.map((r) => ({
        _id: String(r.rid),
        ...(JSON.parse(r.doc as string) as {
          entityType: string;
          entityId: string;
          operation: string;
          actorId: string;
          requestId?: string;
          before?: unknown;
          after?: unknown;
          at: number;
        }),
      }));
    },
  }),

  /**
   * 制作物ごとの集計（A-4 の CSV 書き出し）。システム管理者のみ。
   * teamId に局を渡すとその局と配下の担当、担当を渡すとその担当を主管・制作担当にしている制作物に絞る。CSV にするのは画面
   */
  "admin:workStats": query({
    auth: "user",
    args: object({ teamId: z.string().optional() }),
    handler: async (ctx, args) => exportWorkStats(ctx.db, ctx.principal!, args),
  }),
} satisfies Record<string, FnDef>;
