import { describe, expect, it } from "vite-plus/test";
import { buildDashboard } from "../usecases/dashboard.ts";
import { listSubmitTargets } from "../usecases/home.ts";
import type { InMemoryContext } from "../testing/inMemory.ts";
import { principals } from "../testing/scenario.ts";
import { seedPortfolio, viewers, withoutSummaries } from "./portfolio.ts";

function countReads(ctx: InMemoryContext) {
  const calls = { revisions: 0, threads: 0 };
  const revisions = ctx.revisions.listByWork.bind(ctx.revisions);
  ctx.revisions.listByWork = (id) => {
    calls.revisions++;
    return revisions(id);
  };
  const threads = ctx.threads.listByRevision.bind(ctx.threads);
  ctx.threads.listByRevision = (id) => {
    calls.threads++;
    return threads(id);
  };
  return calls;
}

describe("制作物の要約（workSummaries）", () => {
  it("要約があってもなくても、ダッシュボードと提出先の候補は同じ", async () => {
    const withSummary = await seedPortfolio();
    const fallback = await seedPortfolio();
    withoutSummaries(fallback.ctx);
    for (const who of viewers) {
      const expected = await buildDashboard(fallback.ctx, who, await fallback.works());
      expect(await buildDashboard(withSummary.ctx, who, await withSummary.works())).toEqual(
        expected,
      );
      expect(
        await listSubmitTargets(withSummary.ctx, who, await withSummary.works(), {
          creatorOnly: false,
          includeAccepting: false,
        }),
      ).toEqual(
        await listSubmitTargets(fallback.ctx, who, await fallback.works(), {
          creatorOnly: false,
          includeAccepting: false,
        }),
      );
    }
    const manager = await buildDashboard(fallback.ctx, principals.manager, await fallback.works());
    expect(manager.overview.threads).toEqual({ open: 2, done: 1 });
    expect(manager.overview.stages).toMatchObject({ reviewing: 2, lapsed: 1, unsubmitted: 1 });
  });

  it("要約が揃っていれば、ダッシュボードと提出先の候補は版の全件とスレッドを読まない", async () => {
    const { ctx, works } = await seedPortfolio();
    const calls = countReads(ctx);
    const dashboard = await buildDashboard(ctx, principals.creator, await works());
    expect(dashboard.pinned).toHaveLength(3);
    expect(dashboard.mine.submit.length).toBeGreaterThan(0);
    expect(calls).toEqual({ revisions: 0, threads: 0 });

    withoutSummaries(ctx);
    await buildDashboard(ctx, principals.creator, await works());
    expect(calls.revisions).toBeGreaterThan(0);
    expect(calls.threads).toBeGreaterThan(0);
  });
});
