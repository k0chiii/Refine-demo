import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, HOUR, type Harness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

/** 期限で受付が終わった制作物・受付中で指摘のある制作物・未提出の制作物 */
async function seed(t: Harness) {
  const cast = await createCast(t);
  const lapsed = await setupWork(t, cast, { title: "受付終了" });
  await submitFiles(cast, lapsed, pdf);
  vi.setSystemTime(Date.now() + 49 * HOUR);
  await t.mutation(internal.revisions.closeExpired, {});
  const reviewing = await setupWork(t, cast, { title: "受付中" });
  const { revisionId } = await submitFiles(cast, reviewing, pdf);
  await cast.manager.as.mutation(api.reviews.setReviewers, {
    workId: reviewing,
    reviewerIds: [cast.reviewer.id],
  });
  const post = (body: string) =>
    cast.reviewer.as.mutation(api.comments.post, {
      revisionId,
      body,
      kind: "correction",
      severity: "major",
    });
  const first = (await post("誤字")) as Id<"commentThreads">;
  await post("表記ゆれ");
  await cast.creator.as.mutation(api.comments.decide, { threadId: first, action: "resolved" });
  await setupWork(t, cast, { title: "未提出" });
  for (const workId of [lapsed, reviewing])
    await cast.creator.as.mutation(api.home.setPinned, { workId, pinned: true });
  return cast;
}

type Cast = Awaited<ReturnType<typeof seed>>;

async function readAll(cast: Cast) {
  const out = [];
  for (const who of [cast.creator, cast.manager, cast.reviewer, cast.approver])
    out.push({
      list: await who.as.query(api.works.listMine, {}),
      dashboard: await who.as.query(api.dashboard.get, {}),
      check: await who.as.query(api.dashboard.check, {}),
      make: await who.as.query(api.dashboard.make, {}),
      works: await who.as.query(api.dashboard.works, {}),
      submit: await who.as.query(api.home.submitTargets, {}),
    });
  return out;
}

describe("制作物の要約（workSummaries）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("要約が揃っていても、id だけの古い行でも、行が無くても、一覧・ダッシュボード・提出先は同じ", async () => {
    const t = createHarness();
    const cast = await seed(t);
    const current = await readAll(cast);
    const manager = current[1]!;
    expect(manager.dashboard.overview.threads).toEqual({ open: 1, done: 1 });
    expect(manager.dashboard.overview.stages).toMatchObject({
      reviewing: 1,
      lapsed: 1,
      unsubmitted: 1,
    });
    expect(manager.list.map((w) => [w.title, w.latestRevisionLabel])).toEqual(
      expect.arrayContaining([
        ["受付中", "第1版"],
        ["受付終了", "第1版"],
        ["未提出", null],
      ]),
    );

    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workSummaries").collect())
        await ctx.db.replace(row._id, {
          workId: row.workId,
          latestId: row.latestId,
          acceptingId: row.acceptingId,
          declared: row.declared,
        });
    });
    expect(await readAll(cast)).toEqual(current);

    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workSummaries").collect()) await ctx.db.delete(row._id);
    });
    expect(await readAll(cast)).toEqual(current);
  });

  it("要約が揃っていれば、一覧・ダッシュボード・提出先は版とスレッドを読まない", async () => {
    const t = createHarness();
    const cast = await seed(t);
    const current = await readAll(cast);
    // 書込みの経路を通らずに版とスレッドを消す。読んでいれば結果が変わる
    await t.run(async (ctx) => {
      for (const table of ["commentThreads", "revisions"] as const)
        for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(row._id);
    });
    expect(await readAll(cast)).toEqual(current);

    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workSummaries").collect()) await ctx.db.delete(row._id);
    });
    expect(await readAll(cast)).not.toEqual(current);
  });
});
