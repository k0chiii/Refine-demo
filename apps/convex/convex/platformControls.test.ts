import { describe, expect, it, vi, afterEach } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";
import { setupWork } from "../test/flows";

afterEach(() => vi.unstubAllEnvs());

describe("Platform controls", () => {
  it("reserves AI frequency and character quotas atomically per authenticated user", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-no-network");
    const reserve = () => cast.creator.as.mutation(internal.ai.reserve, { workId, chars: 20_000 });
    const reservations = await Promise.all([reserve(), reserve(), reserve()]);
    expect(reservations.filter((result) => result.ok)).toHaveLength(2);
    expect(reservations.filter((result) => !result.ok)).toHaveLength(1);
    await expect(
      cast.stranger.as.mutation(internal.ai.reserve, { workId, chars: 1 }),
    ).rejects.toThrow();
  });

  it("continues through ACL-empty pages and preserves Japanese substring search", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await setupWork(t, cast, { confidentiality: "restricted", title: "非公開" });
    const visible = await setupWork(t, cast, { title: "五月祭のポスター" });
    const first = await cast.stranger.as.query(api.works.listMinePage, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(first.page).toHaveLength(0);
    expect(first.isDone).toBe(false);
    const next = await cast.stranger.as.query(api.works.listMinePage, {
      text: "月祭の",
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(next.page.map((w) => w.id)).toEqual([visible]);
  });

  it("keeps legacy submission candidates until roles are repaired, then follows transactional role changes", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    await t.run(async (ctx) => {
      await ctx.db.patch(workId, { rolesVersion: undefined });
      for (const role of await ctx.db
        .query("workRoles")
        .withIndex("by_work", (q) => q.eq("workId", workId))
        .collect())
        await ctx.db.delete(role._id);
    });
    expect((await cast.creator.as.query(api.home.submitTargets, {})).map((w) => w.workId)).toEqual([
      workId,
    ]);
    await cast.manager.as.mutation(api.works.update, {
      workId,
      patch: { creatorIds: [cast.stranger.id] },
    });
    expect(await cast.creator.as.query(api.home.submitTargets, {})).toEqual([]);
    expect((await cast.stranger.as.query(api.home.submitTargets, {})).map((w) => w.workId)).toEqual(
      [workId],
    );
  });
  it("repairs legacy role rows idempotently without changing the business version", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const original = await t.run(async (ctx) => {
      const work = await ctx.db.get(workId);
      await ctx.db.patch(workId, { rolesVersion: undefined });
      for (const row of await ctx.db
        .query("workRoles")
        .withIndex("by_work", (q) => q.eq("workId", workId))
        .collect())
        await ctx.db.delete(row._id);
      return work!.version;
    });
    await t.mutation(internal.migrations.backfillWorkRoles, { cursor: null, oneBatchOnly: true });
    const count = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("workRoles")
            .withIndex("by_work", (q) => q.eq("workId", workId))
            .collect()
        ).length,
    );
    expect(count).toBeGreaterThan(0);
    await t.mutation(internal.migrations.backfillWorkRoles, {
      cursor: null,
      oneBatchOnly: true,
      reset: true,
    });
    const after = await t.run(async (ctx) => ({
      work: await ctx.db.get(workId),
      roles: await ctx.db
        .query("workRoles")
        .withIndex("by_work", (q) => q.eq("workId", workId))
        .collect(),
    }));
    expect(after.work).toMatchObject({ rolesVersion: 1, version: original });
    expect(after.roles).toHaveLength(count);
  });
});
