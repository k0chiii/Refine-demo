import type { FunctionReturnType } from "convex/server";
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import { substringQuery, substringTokens, workSearchText } from "./lib/workSearch";

it("日本語・空白・大小文字・サロゲートペアを語の境界によらず候補化する", () => {
  for (const [text, query] of [
    ["五月祭のご案内", "祭のご"],
    ["AB CD", "b c"],
    ["案内🎉会場", "🎉会"],
  ]) {
    expect(substringTokens(text!).split(" ")).toContain(substringQuery(query!));
  }
});

type T = ReturnType<typeof createHarness>;
type Cast = Awaited<ReturnType<typeof createCast>>;

async function setup() {
  const t = createHarness();
  const c = await createCast(t);
  const create = async (title: string, year = 100) =>
    (await c.manager.as.mutation(api.works.create, {
      title,
      purpose: "構内の案内",
      category: "文章",
      tags: ["来場者向け"],
      mediaType: "document",
      year,
      creatorIds: [c.creator.id],
      approverId: c.approver.id,
    })) as Id<"works">;
  return { t, c, create };
}

async function pages(
  c: Cast,
  text: string,
  filters: { year?: number; lifecycle?: "active" | "cancelled" } = { year: 100 },
) {
  const all: string[] = [];
  let cursor: string | null = null;
  for (let n = 0; n < 30; n++) {
    const page: FunctionReturnType<typeof api.works.listMinePage> = await c.stranger.as.query(
      api.works.listMinePage,
      { text, ...filters, paginationOpts: { cursor, numItems: 1 } },
    );
    all.push(...page.page.map((w) => w.id));
    if (page.isDone) return all.sort();
    cursor = page.continueCursor;
  }
  throw new Error("cursor did not finish");
}

const searchRows = (t: T, workId: Id<"works">) =>
  t.run((ctx) =>
    ctx.db
      .query("workSearch")
      .withIndex("by_work", (q) => q.eq("workId", workId))
      .collect(),
  );

/** 検索の行が無い制作物（移行前の行・シードの行）。works には token を持たない */
async function makeLegacy(t: T, workId: Id<"works">) {
  await t.run(async (ctx) => {
    for (const row of await ctx.db
      .query("workSearch")
      .withIndex("by_work", (q) => q.eq("workId", workId))
      .collect())
      await ctx.db.delete(row._id);
    await ctx.db.patch(workId, { searchVersion: undefined });
  });
}

describe("検索と要約の派生データ", () => {
  it("新旧索引のページを継続し、複数項目部分一致・ACL・更新・移行を保つ", async () => {
    const { t, c, create } = await setup();
    const current = await create("五月祭の受付");
    const old = await create("五月祭の旧受付");
    const unindexed = await create("五月祭の未索引");
    const secret = await create("五月祭の非公開");
    await makeLegacy(t, old);
    await makeLegacy(t, unindexed);
    const everything = [current, old, unindexed, secret].sort();
    expect(await pages(c, "祭の")).toEqual(everything);
    expect(await pages(c, "場者")).toEqual(everything);
    await c.manager.as.mutation(api.works.update, { workId: current, patch: { title: "新受付" } });
    expect(await pages(c, "祭の")).toEqual([old, unindexed, secret].sort());
    expect(await pages(c, "新受")).toEqual([current]);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("workSummaries")
          .withIndex("by_work", (q) => q.eq("workId", current))
          .unique(),
      ),
    ).not.toBeNull();
  });

  it("works の行に token を持たず、検索の行を登録・更新・状態の変更に合わせる", async () => {
    const { t, c, create } = await setup();
    const workId = await create("五月祭の受付");
    const other = await create("五月祭の別年度", 99);
    const doc = await t.run((ctx) => ctx.db.get(workId));
    expect(doc).not.toHaveProperty("searchTokens");
    expect(doc?.searchVersion).toBe(1);
    expect(await searchRows(t, workId)).toMatchObject([{ year: 100, lifecycle: "active" }]);
    expect(await pages(c, "祭の", {})).toEqual([workId, other].sort());
    expect(await pages(c, "祭の", { year: 99 })).toEqual([other]);

    await c.manager.as.mutation(api.works.update, {
      workId,
      patch: { title: "春の受付", tags: ["案内所"] },
    });
    expect(await t.run((ctx) => ctx.db.get(workId))).not.toHaveProperty("searchTokens");
    expect(await searchRows(t, workId)).toHaveLength(1);
    expect(await pages(c, "祭の")).toEqual([]);
    expect(await pages(c, "内所")).toEqual([workId]);

    await c.manager.as.mutation(api.works.changeLifecycle, { workId, to: "cancelled" });
    expect(await searchRows(t, workId)).toMatchObject([{ year: 100, lifecycle: "cancelled" }]);
    expect(await pages(c, "春の", { year: 100, lifecycle: "cancelled" })).toEqual([workId]);
    expect(await pages(c, "春の", { year: 100, lifecycle: "active" })).toEqual([]);
  });

  it("移行は検索の行を作り、印を付ける（何度流しても同じ）", async () => {
    const { t, c, create } = await setup();
    const old = await create("五月祭の旧受付");
    const unindexed = await create("五月祭の未索引");
    await makeLegacy(t, old);
    await makeLegacy(t, unindexed);
    const before = await t.run((ctx) => ctx.db.get(old));
    expect(await searchRows(t, old)).toHaveLength(0);

    await t.mutation(internal.migrations.moveWorkSearchTokens, {
      cursor: null,
      oneBatchOnly: true,
    });
    await t.mutation(internal.migrations.moveWorkSearchTokens, {
      cursor: null,
      oneBatchOnly: true,
      reset: true,
    });
    for (const workId of [old, unindexed]) {
      const doc = await t.run((ctx) => ctx.db.get(workId));
      expect(doc).not.toHaveProperty("searchTokens");
      expect(doc).toMatchObject({ searchVersion: 1, version: before!.version });
      expect(await searchRows(t, workId)).toHaveLength(1);
    }
    expect((await searchRows(t, old))[0]!.searchTokens).toBe(
      substringTokens(workSearchText(before!)),
    );
    expect(await pages(c, "祭の")).toEqual([old, unindexed].sort());
  });
});
