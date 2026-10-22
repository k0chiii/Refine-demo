import { afterEach, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";
import { setupWork } from "../test/flows";
afterEach(() => vi.unstubAllEnvs());
it("意味検索の取得後に ACL と現行ルール版を照合して、古い埋め込みを捨てる", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-no-network");
  vi.stubEnv("AI_ALLOW_RESTRICTED", "true");
  const t = createHarness();
  const c = await createCast(t);
  const rule = {
    ruleId: "A1-0001",
    categoryCode: "A1",
    title: "五月祭",
    description: "表記",
    correct: ["五月祭"],
    incorrect: [],
    patterns: ["[5５]月祭"],
    exceptions: [],
    language: "ja" as const,
    scopes: [],
    years: [100],
    priority: 0,
    strictness: "required" as const,
    enabled: true,
  };
  await c.admin.as.mutation(api.notation.save, { rule, expectedRevision: 0 });
  const workId = await setupWork(t, c, {
    notationCategories: ["B"],
    confidentiality: "restricted",
  });
  await t.mutation(internal.semanticRules.store, {
    ruleId: rule.ruleId,
    revision: 1,
    vector: [1, ...Array<number>(1023).fill(0)],
  });
  const id = await t.run(async (ctx) => (await ctx.db.query("ruleEmbeddings").first())!._id);
  expect(
    await c.creator.as.query(internal.semanticRules.resolve, { workId, ids: [id] }),
  ).toHaveLength(1);
  await expect(
    c.stranger.as.query(internal.semanticRules.resolve, { workId, ids: [id] }),
  ).rejects.toThrow();
  await c.admin.as.mutation(api.notation.save, {
    rule: { ...rule, description: "新版" },
    expectedRevision: 1,
  });
  expect(await c.creator.as.query(internal.semanticRules.resolve, { workId, ids: [id] })).toEqual(
    [],
  );
});
