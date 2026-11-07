import {
  buildCheckDashboard,
  buildMakeDashboard,
  buildWorksDashboard,
  type AppContext,
} from "@mf100/application";
import { isAccepting, type Principal, type Work } from "@mf100/domain";
import { query, type FnCtx, type FnDef } from "./define.ts";
import { listCandidates, listMyWorks } from "./workList.ts";
import { object } from "./validators.ts";

// apps/convex/convex/dashboard.ts の写し。節に行が出うる制作物は workRoles・許可・割当の索引から読む（Convex の listWorksRelatedTo と同じ）。
// システム管理者はすべての操作ができるので全件

const section = <T>(
  build: (db: AppContext, principal: Principal, works: Work[]) => Promise<T>,
  /** 無ければ全件（制作物の状況）。あれば、割当・専門確認から引くかどうか */
  related?: { assignments: boolean },
) => ({
  auth: "user" as const,
  args: object({}),
  handler: async (ctx: FnCtx): Promise<T> =>
    build(
      ctx.db,
      ctx.principal!,
      related ? await listCandidates(ctx, ctx.principal!, related) : await listMyWorks(ctx),
    ),
});

export const dashboard = {
  /** 校正の入口と `/` の振り分け: 校正する・専門確認・校了・割り当てると、自分の分が終わったもの */
  "dashboard:check": query(section(buildCheckDashboard, { assignments: true })),

  /** 制作の入口: 提出する・返事をする・自分が制作者の制作物の行・自分宛てのコメント */
  "dashboard:make": query(
    section((db, principal, works) => buildMakeDashboard(db, principal, works), {
      assignments: false,
    }),
  ),

  /** 制作物の一覧の先頭: 制作物の状況（数字・滞っている制作物・内訳）とピン留め */
  "dashboard:works": query(section(buildWorksDashboard)),

  /**
   * 校正のナビのバッジ（自分の手が要る数）: 未完了の割当（未着手・確認中）＋自分担当の未完了の専門確認。受付中の版だけ数える。
   * 読むのは自分の割当・専門確認とその版だけ（dashboard:check＝進行中の全制作物を読むより桁違いに軽い）。
   * 校了待ちは含めない（未解決コメント・専門確認の判定で全制作物を読むため）。同じ版に割当と専門確認があれば 2 と数える（Convex と同じ）
   */
  "dashboard:checkBadge": query({
    auth: "user",
    args: object({}),
    handler: async (ctx): Promise<{ count: number }> => {
      const me = ctx.userId!;
      const revisionIds: string[] = [
        ...ctx.sql
          .exec(
            "SELECT revisionId FROM assignments WHERE reviewerId = ? AND json_extract(doc, '$.state') IN ('pending', 'viewed') ORDER BY rowid",
            me,
          )
          .map((r) => r.revisionId as string),
        ...ctx.sql
          .exec(
            "SELECT revisionId FROM checks WHERE assigneeId = ? AND json_extract(doc, '$.state') = 'pending' ORDER BY rowid",
            me,
          )
          .map((r) => r.revisionId as string),
      ];
      const accepting = new Map<string, boolean>();
      let count = 0;
      for (const id of revisionIds) {
        let ok = accepting.get(id);
        if (ok === undefined) {
          const revision = await ctx.db.revisions.findById(id);
          ok = revision !== null && isAccepting(revision);
          accepting.set(id, ok);
        }
        if (ok) count++;
      }
      return { count };
    },
  }),
} satisfies Record<string, FnDef>;
