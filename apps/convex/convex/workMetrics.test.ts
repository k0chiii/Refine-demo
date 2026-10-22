import { expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";
import { setupWork } from "../test/flows";
it("Aggregate は書込みと同時に変わり、非公開の件数と移行状況を一般利用者に出さない", async () => {
  const t = createHarness();
  const c = await createCast(t);
  await setupWork(t, c);
  const restricted = await setupWork(t, c, { confidentiality: "restricted" });
  const total = async (as: typeof c.creator.as) => {
    const result = await as.query(api.workMetrics.counts, { year: 100 });
    return { ready: result.ready, total: result.counts.reduce((sum, row) => sum + row.count, 0) };
  };
  expect(await total(c.stranger.as)).toEqual({ ready: true, total: 1 });
  expect(await total(c.admin.as)).toEqual({ ready: true, total: 2 });
  await t.run((ctx) => ctx.db.patch(restricted, { aggregateVersion: undefined }));
  expect(await total(c.stranger.as)).toEqual({ ready: true, total: 1 });
  expect(await total(c.admin.as)).toEqual({ ready: false, total: 0 });
  await c.manager.as.mutation(api.works.update, {
    workId: restricted,
    patch: { confidentiality: "normal" },
  });
  expect(await total(c.stranger.as)).toEqual({ ready: true, total: 2 });
});
