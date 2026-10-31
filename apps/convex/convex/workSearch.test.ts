import type { FunctionReturnType } from "convex/server";
import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import { substringQuery, substringTokens } from "./lib/workSearch";

it("日本語・空白・大小文字・サロゲートペアを語の境界によらず候補化する", () => {
  for (const [text, query] of [
    ["五月祭のご案内", "祭のご"],
    ["AB CD", "b c"],
    ["案内🎉会場", "🎉会"],
  ]) {
    expect(substringTokens(text!).split(" ")).toContain(substringQuery(query!));
  }
});

describe("検索と要約の派生データ", () => {
  it("新旧索引のページを継続し、複数項目部分一致・ACL・更新・移行を保つ", async () => {
    const t = createHarness();
    const c = await createCast(t);
    const create = async (title: string) =>
      (await c.manager.as.mutation(api.works.create, {
        title,
        purpose: "構内の案内",
        category: "文章",
        tags: ["来場者向け"],
        mediaType: "document",
        year: 100,
        creatorIds: [c.creator.id],
        approverId: c.approver.id,
      })) as Id<"works">;
    const current = await create("五月祭の受付");
    const legacy = await create("五月祭の旧受付");
    const secret = await create("五月祭の非公開");
    await t.run(async (ctx) => {
      await ctx.db.patch(legacy, { searchTokens: undefined });
    });
    const pages = async (text: string) => {
      const all: string[] = [];
      let cursor: string | null = null;
      for (let n = 0; n < 20; n++) {
        const page: FunctionReturnType<typeof api.works.listMinePage> = await c.stranger.as.query(
          api.works.listMinePage,
          { text, year: 100, paginationOpts: { cursor, numItems: 1 } },
        );
        all.push(...page.page.map((w) => w.id));
        if (page.isDone) return all;
        cursor = page.continueCursor;
      }
      throw new Error("cursor did not finish");
    };
    expect((await pages("祭の")).sort()).toEqual([current, legacy, secret].sort());
    expect((await pages("場者")).sort()).toEqual([current, legacy].sort());
    await c.manager.as.mutation(api.works.update, { workId: current, patch: { title: "新受付" } });
    expect(await pages("祭の")).toEqual([legacy]);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("workSummaries")
          .withIndex("by_work", (q) => q.eq("workId", current))
          .unique(),
      ),
    ).not.toBeNull();
  });
});
