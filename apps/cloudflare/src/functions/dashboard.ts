import {
  buildCheckDashboard,
  buildMakeDashboard,
  buildWorksDashboard,
  type AppContext,
} from "@mf100/application";
import type { Principal, Work } from "@mf100/domain";
import { query, type FnCtx, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/dashboard.ts の写し。Convex は「関係する制作物だけ」を索引から読んで購読の再実行を減らすが、
// ここは購読の単位が表で、読みも手元の SQLite なので、全件（listMyWorks 相当）から作る。節に行が出るかは build* が決める

/** 一覧で読む制作物の上限（Convex の WORKS_SCAN_LIMIT と同じ） */
const WORKS_SCAN_LIMIT = 2000;

const section = <T>(
  build: (db: AppContext, principal: Principal, works: Work[]) => Promise<T>,
) => ({
  auth: "user" as const,
  args: object({}),
  handler: async (ctx: FnCtx): Promise<T> =>
    build(ctx.db, ctx.principal!, await ctx.db.works.list(WORKS_SCAN_LIMIT)),
});

export const dashboard = {
  /** 校正の入口と `/` の振り分け: 校正する・専門確認・校了・割り当てると、自分の分が終わったもの */
  "dashboard:check": query(section(buildCheckDashboard)),

  /** 制作の入口: 提出する・返事をする・自分が制作者の制作物の行・自分宛てのコメント */
  "dashboard:make": query(
    section((db, principal, works) => buildMakeDashboard(db, principal, works)),
  ),

  /** 制作物の一覧の先頭: 制作物の状況（数字・滞っている制作物・内訳）とピン留め */
  "dashboard:works": query(section(buildWorksDashboard)),
} satisfies Record<string, FnDef>;
