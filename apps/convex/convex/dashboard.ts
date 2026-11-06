import {
  buildCheckDashboard,
  buildDashboard,
  buildMakeDashboard,
  buildWorksDashboard,
  type AppContext,
} from "@mf100/application";
import { isAccepting, overridesAllPermissions, type Principal, type Work } from "@mf100/domain";
import type { Id } from "./_generated/dataModel";
import { internalQuery, query, type DatabaseReader, type QueryCtx } from "./_generated/server";
import { createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { listMyWorks, listWorksRelatedTo } from "./works.ts";

type Candidates = (db: DatabaseReader, principal: Principal) => Promise<Work[]>;

/**
 * 自分が関わる制作物から、ダッシュボードの節を作る問い合わせ。candidates は節に行が出うる制作物の読み方。
 * 全件（制作物の状況）以外は索引から候補だけを読む: 読む量が減り、関係のない制作物の書込みで購読が再実行されない
 */
function dashboardHandler<T>(
  build: (ctx: AppContext, principal: Principal, works: Work[]) => Promise<T>,
  candidates: Candidates = listMyWorks,
) {
  return {
    args: {},
    handler: async (ctx: QueryCtx): Promise<T> => {
      const { principal } = await requireUser(ctx);
      const works = await candidates(ctx.db, principal);
      return runUseCase(() => build(createReadContext(ctx.db), principal, works));
    },
  };
}

function dashboardQuery<T>(
  build: (ctx: AppContext, principal: Principal, works: Work[]) => Promise<T>,
  candidates?: Candidates,
) {
  return query(dashboardHandler(build, candidates));
}

/** システム管理者はすべての操作ができるので全件。それ以外は職責・割当・許可から（{@link listWorksRelatedTo}） */
const related =
  (assignments: boolean): Candidates =>
  (db, principal) =>
    overridesAllPermissions(principal)
      ? listMyWorks(db, principal)
      : listWorksRelatedTo(db, principal, { assignments });

/**
 * ダッシュボード（U-00）の全部の節。画面は節ごとの check・make・works を読み、これは呼ばない。
 * 古い画面（SW のキャッシュ）からの呼び出しで全件読みが続いていたので、外からは呼べないようにした（利用者決定 2026-11-06）。
 * 各節がこの全部入りの同じ節と一致することを確かめるテストのためだけに、内部の問い合わせとして残す
 */
export const get = internalQuery(dashboardHandler(buildDashboard));

/** 校正の入口と `/` の振り分け: 校正する・専門確認・校了・割り当てると、自分の分が終わったもの */
export const check = dashboardQuery(buildCheckDashboard, related(true));

/** 制作の入口: 提出する・返事をする・自分が制作者の制作物の行・自分宛てのコメント */
export const make = dashboardQuery(buildMakeDashboard, related(false));

/** 制作物の一覧の先頭: 制作物の状況（数字・滞っている制作物・内訳）とピン留め */
export const works = dashboardQuery(buildWorksDashboard);

/**
 * 校正のナビのバッジ（自分の手が要る数）: 未完了の割当（未着手・確認中）＋自分担当の未完了の専門確認。受付中の版だけ数える。
 * 読むのは自分の割当・専門確認とその版だけ（dashboard.check＝進行中の全制作物を読むより桁違いに軽い。docs/COST.md 2.2）。
 * 校了待ちは含めない（未解決コメント・専門確認の判定で全制作物を読むため）
 */
export const checkBadge = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    const me = principal.userId;
    const revisionIds: Array<Id<"revisions">> = [];
    for (const state of ["pending", "viewed"] as const)
      for (const a of await ctx.db
        .query("reviewAssignments")
        .withIndex("by_reviewer_state", (q) => q.eq("reviewerId", me).eq("state", state))
        .collect())
        revisionIds.push(a.revisionId);
    for (const c of await ctx.db
      .query("requiredChecks")
      .withIndex("by_assignee_state", (q) => q.eq("assigneeId", me).eq("state", "pending"))
      .collect())
      revisionIds.push(c.revisionId);
    const read = createReadContext(ctx.db);
    const accepting = new Map<string, boolean>();
    let count = 0;
    for (const id of revisionIds) {
      let ok = accepting.get(id);
      if (ok === undefined) {
        const revision = await read.revisions.findById(id);
        ok = revision !== null && isAccepting(revision);
        accepting.set(id, ok);
      }
      if (ok) count++;
    }
    return { count };
  },
});
