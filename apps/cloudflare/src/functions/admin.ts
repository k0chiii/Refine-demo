import { exportWorkStats } from "@mf100/application";
import { z } from "zod";
import { query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/admin.ts の写し（setSystemAdmin / auditLog などの管理者の読み書きは別の単位）

export const admin = {
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
