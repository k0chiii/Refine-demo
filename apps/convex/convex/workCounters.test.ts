import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, type Harness } from "../test/harness";
import { profileReads } from "../test/readProfile";
import { setupWork, submitFiles } from "../test/flows";
import { worksSection } from "./dashboard";
import { createAppContext } from "./lib/adapters";
import { readFinalizedCounts } from "./lib/workCounters";

const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

type Cast = Awaited<ReturnType<typeof createCast>>;

async function seed(t: Harness) {
  const cast = await createCast(t);
  const teams = await t.run(async (ctx) => {
    const make = (name: string) =>
      ctx.db.insert("teams", {
        name,
        kind: "bureau",
        order: 1,
        updatedAt: 0,
        updatedBy: "test",
      });
    return { a: await make("制作局"), b: await make("広報局") };
  });
  const works = [];
  for (const [title, team] of [
    ["A1", teams.a],
    ["A2", teams.a],
    ["B1", teams.b],
    ["N1", undefined],
    ["N2", undefined],
    ["進行中", teams.a],
  ] as const) {
    const id = await setupWork(t, cast, { title });
    if (team)
      await t.run(async (ctx) => {
        const app = createAppContext(ctx);
        await app.works.update({ ...(await app.works.findById(id))!, ownerTeamId: team });
      });
    works.push(id);
  }
  await submitFiles(cast, works[5]!, pdf);
  return { cast, teams, works };
}

/** 校了にする・戻す・取り消す。本番と同じ経路（アダプタの works.update）で書く */
async function setLifecycle(
  t: Harness,
  workId: Id<"works">,
  lifecycle: "active" | "finalized" | "on_hold" | "cancelled",
) {
  await t.run(async (ctx) => {
    const app = createAppContext(ctx);
    await app.works.update({ ...(await app.works.findById(workId))!, lifecycle });
  });
}

async function readAll(cast: Cast) {
  const out = [];
  for (const who of [cast.creator, cast.manager, cast.reviewer, cast.approver, cast.stranger])
    out.push(await who.as.query(api.dashboard.works, {}));
  return out;
}

const counts = (t: Harness) => t.run((ctx) => readFinalizedCounts(ctx.db));

describe("校了した制作物の数（workCounters）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("行が無い間は全件から数え、埋めたあとは校了した制作物を読まずに、同じ値を返す", async () => {
    const t = createHarness();
    const { cast, teams, works } = await seed(t);
    await setLifecycle(t, works[0]!, "finalized");
    await setLifecycle(t, works[1]!, "finalized");
    await setLifecycle(t, works[2]!, "finalized");
    await setLifecycle(t, works[3]!, "finalized");
    await setLifecycle(t, works[4]!, "on_hold");
    expect(await counts(t)).toBeNull();
    const full = await readAll(cast);
    expect(full[1]!.overview.stages).toMatchObject({ finalized: 4, on_hold: 1 });

    await t.mutation(internal.migrations.rebuildWorkCounters, {});
    expect(await counts(t)).toEqual({ [teams.a]: 2, [teams.b]: 1, none: 1 });
    const narrowed = await profileReads(() => cast.manager.as.query(api.dashboard.works, {}));
    expect(await readAll(cast)).toEqual(full);
    // 校了した制作物の文書は読まない（読むのは校了していない制作物だけ）
    expect(narrowed.byTable.works?.docs).toBe(2);
  });

  it("書込みのたびに増減し、いつでも数え直した値と同じ（校了・取り戻し・取消・主管担当の変更）", async () => {
    const t = createHarness();
    const { cast, teams, works } = await seed(t);
    await t.mutation(internal.migrations.rebuildWorkCounters, {});
    const check = async () => {
      const incremental = await counts(t);
      await t.mutation(internal.migrations.rebuildWorkCounters, {});
      expect(await counts(t)).toEqual(incremental);
    };
    expect(await counts(t)).toEqual({});
    await setLifecycle(t, works[0]!, "finalized");
    await check();
    await setLifecycle(t, works[3]!, "finalized");
    await check();
    expect(await counts(t)).toEqual({ [teams.a]: 1, none: 1 });
    // 主管担当を変えると、数える先が移る
    await t.run(async (ctx) => {
      const app = createAppContext(ctx);
      await app.works.update({ ...(await app.works.findById(works[0]!))!, ownerTeamId: teams.b });
    });
    await check();
    expect(await counts(t)).toEqual({ [teams.b]: 1, none: 1 });
    // 取り戻す・取り消すと減る（0 になった鍵は残さない）
    await setLifecycle(t, works[0]!, "active");
    await setLifecycle(t, works[3]!, "cancelled");
    await check();
    expect(await counts(t)).toEqual({});
    // 校了のまま内容だけ書き換えても数は変わらない
    await setLifecycle(t, works[1]!, "finalized");
    await setLifecycle(t, works[1]!, "finalized");
    await check();
    expect(await counts(t)).toEqual({ [teams.a]: 1 });
    // 同じ鍵に 2 件あるときは、1 件を戻しても鍵は残り、1 だけ減る
    await setLifecycle(t, works[5]!, "finalized");
    await setLifecycle(t, works[1]!, "active");
    await check();
    expect(await counts(t)).toEqual({ [teams.a]: 1 });
    // 全体の状況は、いつでも全件を読んだ値と同じ
    const narrowed = await readAll(cast);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workCounters").collect()) await ctx.db.delete(row._id);
    });
    expect(await readAll(cast)).toEqual(narrowed);
  });

  it("読む上限を超える数の制作物があっても、数の行が有っても無くても同じ結果を返す", async () => {
    const t = createHarness();
    const { cast, works } = await seed(t);
    // 6 件: 校了 4・保留 1・進行中 1。作成順の先頭 4 件は全部校了
    for (const id of works.slice(0, 4)) await setLifecycle(t, id, "finalized");
    await setLifecycle(t, works[4]!, "on_hold");
    const sectionAt = (limit: number) => cast.manager.as.run((ctx) => worksSection(ctx, limit));
    const withoutRow: Record<number, unknown> = {};
    const limits = [3, 4, 5, 6, 7, 100];
    for (const limit of limits) withoutRow[limit] = await sectionAt(limit);
    // 上限で打ち切る従来の読み方は、上限が小さいと校了の数を取りこぼす（この比較が意味を持つ前提）
    expect(withoutRow[4]).not.toEqual(withoutRow[100]);

    await t.mutation(internal.migrations.rebuildWorkCounters, {});
    for (const limit of limits) expect(await sectionAt(limit)).toEqual(withoutRow[limit]);
    // 収まるときは、数の行で校了した制作物の文書を読まない（上限が 6 以上）
    const fits = await profileReads(() => cast.manager.as.run((ctx) => worksSection(ctx, 6)));
    expect(fits.byTable.works?.docs).toBe(2);
    // 収まらないときは従来どおり先頭から上限まで読む
    const over = await profileReads(() => cast.manager.as.run((ctx) => worksSection(ctx, 5)));
    expect(over.byTable.works?.docs).toBeGreaterThanOrEqual(5);
  });

  it("校了の有無も主管担当も変わらない制作物の書込みは、数の行を読まず書かない", async () => {
    const t = createHarness();
    const { works } = await seed(t);
    await t.mutation(internal.migrations.rebuildWorkCounters, {});
    await setLifecycle(t, works[0]!, "finalized");
    // 校了のまま・進行中のままの題名の変更。数の行は 1 行だけなので、読むだけでも制作物の書込みどうしが衝突する
    for (const id of [works[0]!, works[5]!]) {
      const run = await profileReads(() =>
        t.run(async (ctx) => {
          const app = createAppContext(ctx);
          await app.works.update({ ...(await app.works.findById(id))!, title: "改題" });
        }),
      );
      expect(run.writes.works).toBeGreaterThan(0);
      expect(run.writes.workCounters).toBeUndefined();
      expect(run.byTable.workCounters).toBeUndefined();
    }
  });

  it("数え直し（rebuildWorkCounters）は、ずれた数を直し、数が同じなら鍵の順が違っても書かない", async () => {
    const t = createHarness();
    const { teams, works } = await seed(t);
    await t.mutation(internal.migrations.rebuildWorkCounters, {});
    // 保存した行の鍵は名前の順（none は担当の ID より後）に並び、数え直しは制作物の作成順に鍵を足す。
    // 主管担当の無い制作物を先に作ったので、2 つは鍵の順だけが違う
    await setLifecycle(t, works[3]!, "finalized");
    await setLifecycle(t, works[5]!, "finalized");
    const want = { [teams.a]: 1, none: 1 };
    expect(await counts(t)).toEqual(want);
    const same = await profileReads(() => t.mutation(internal.migrations.rebuildWorkCounters, {}));
    expect(same.writes.workCounters).toBeUndefined();

    await t.run(async (ctx) => {
      const row = (await ctx.db.query("workCounters").unique())!;
      await ctx.db.patch(row._id, { counts: { [teams.a]: 5 } });
    });
    expect(await t.mutation(internal.migrations.rebuildWorkCounters, {})).toEqual(want);
    expect(await counts(t)).toEqual(want);
  });
});
