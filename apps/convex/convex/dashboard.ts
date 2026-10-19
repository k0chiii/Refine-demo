import { buildDashboard } from "@mf100/application";
import { isAccepting } from "@mf100/domain";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { listMyWorks } from "./works.ts";

/** ダッシュボード（U-00）: あなたの担当と、自分が関わる制作物で溜まっているもの。 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    const works = await listMyWorks(ctx.db, principal);
    return runUseCase(() => buildDashboard(createReadContext(ctx.db), principal, works));
  },
});

/**
 * 校正のナビのバッジ（自分の手が要る数）: 未完了の割当（未着手・確認中）＋自分担当の未完了の専門確認。受付中の版だけ数える。
 * 読むのは自分の割当・専門確認とその版だけ（dashboard.get＝全制作物を常時購読するより桁違いに軽い。docs/COST.md 2.2）。
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
