import { revisionThreadStatsOf, threadTallyOf } from "@mf100/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import { createCast, createHarness, type Harness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";
import { createAppContext } from "./lib/adapters";
import { syncRevisionThreadStats } from "./lib/revisionThreadStats";

/**
 * コメントの書込みのたびに作り直す派生件数（版の件数・制作物の要約）の読み書きを減らす。
 * 指標: 1 回の同期で読む表（query の回数）と書く文書。結果（件数・要約）は全部を数え直したときと同じ。
 */
const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

/** db の query と書込みを記録する（読み書きの中身はそのまま本物へ渡す） */
function recording(db: DatabaseWriter) {
  const queries: string[] = [];
  const writes: string[] = [];
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "query")
        return (table: string) => {
          queries.push(table);
          return (value as (t: string) => unknown).call(target, table);
        };
      if (prop === "patch" || prop === "replace" || prop === "insert" || prop === "delete")
        return (...args: unknown[]) => {
          writes.push(`${prop}:${String(args[0])}`);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
  return { db: wrapped, queries, writes };
}

async function seed(t: Harness) {
  const cast = await createCast(t);
  const workId = await setupWork(t, cast);
  const { revisionId } = await submitFiles(cast, workId, pdf);
  const threadIds: Id<"commentThreads">[] = [];
  for (const body of ["誤字", "表記ゆれ", "配色"])
    threadIds.push(
      (await cast.reviewer.as.mutation(api.comments.post, {
        revisionId,
        body,
        kind: "correction",
        severity: "major",
      })) as Id<"commentThreads">,
    );
  return { cast, workId, revisionId, threadIds };
}

/** 版の件数と要約の指摘の数が、スレッドを全部数え直した値と同じか */
async function expectDerivedMatchesThreads(
  t: Harness,
  workId: Id<"works">,
  revisionId: Id<"revisions">,
) {
  await t.run(async (ctx) => {
    const live = (
      await ctx.db
        .query("commentThreads")
        .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
        .collect()
    ).filter((d) => d.deletedAt === undefined);
    const stats = revisionThreadStatsOf(live);
    const revision = await ctx.db.get(revisionId);
    expect(revision).toMatchObject({
      unresolvedCount: stats.unresolved,
      openBotCount: stats.openBot,
      threadCount: stats.total,
    });
    const summary = await ctx.db
      .query("workSummaries")
      .withIndex("by_work", (q) => q.eq("workId", workId))
      .unique();
    expect(summary?.threads).toEqual(threadTallyOf(live));
  });
}

describe("版のスレッド件数の同期（読み書きの削減）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("件数が変わらなければ、版も要約も書き直さない（購読を走らせない）", async () => {
    const t = createHarness();
    const { revisionId } = await seed(t);
    await t.run(async (ctx) => {
      const r = recording(ctx.db);
      await syncRevisionThreadStats(r.db, revisionId);
      expect(r.writes).toEqual([]);
    });
  });

  it("受付中の版のスレッドは 1 回の同期で 1 回だけ読む", async () => {
    const t = createHarness();
    const { workId, revisionId, threadIds } = await seed(t);
    await t.run(async (ctx) => {
      // 書込みの経路を通らずに 1 件を片付ける → 件数と要約が変わる
      await ctx.db.patch(threadIds[0]!, { resolution: "resolved" });
      const r = recording(ctx.db);
      await syncRevisionThreadStats(r.db, revisionId);
      expect(r.queries.filter((q) => q === "commentThreads")).toHaveLength(1);
      expect(r.writes.filter((w) => w.startsWith("patch:"))).toEqual([`patch:${revisionId}`]);
      expect(r.writes.filter((w) => w.startsWith("replace:"))).toHaveLength(1);
    });
    await expectDerivedMatchesThreads(t, workId, revisionId);
  });

  it("要約の数える版でない版の同期では、要約は数える版のスレッドを読む", async () => {
    const t = createHarness();
    const { cast, workId, revisionId: first } = await seed(t);
    const { revisionId: second } = await submitFiles(cast, workId, pdf);
    await cast.reviewer.as.mutation(api.comments.post, {
      revisionId: second,
      body: "第2版の指摘",
      kind: "correction",
      severity: "major",
    });
    await t.run(async (ctx) => {
      const r = recording(ctx.db);
      await syncRevisionThreadStats(r.db, first);
      expect(r.queries.filter((q) => q === "commentThreads")).toHaveLength(2);
      expect(r.writes).toEqual([]);
    });
    await expectDerivedMatchesThreads(t, workId, second);
  });

  it("数える項目の変わらないスレッドの更新（リアクション・担当など）は件数を同期しない", async () => {
    const t = createHarness();
    const { revisionId, threadIds } = await seed(t);
    await t.run(async (ctx) => {
      const thread = (await createAppContext(ctx.db).threads.findById(threadIds[0]!))!;
      const r = recording(ctx.db);
      await createAppContext(r.db).threads.update({
        ...thread,
        reactions: [{ emoji: "👍", userIds: ["someone"] }],
        editCount: 1,
      } as typeof thread);
      expect(r.queries).toEqual([]);
      expect(r.writes).toEqual([`replace:${threadIds[0]}`]);
      expect(await ctx.db.get(revisionId)).toMatchObject({ unresolvedCount: 3, threadCount: 3 });
    });
  });

  it("採否・削除・作成日時・投稿元の変わる更新は件数を同期する", async () => {
    const t = createHarness();
    const { workId, revisionId, threadIds } = await seed(t);
    const changes = [
      { resolution: "resolved" as const },
      { deletedAt: Date.now() },
      { createdAt: Date.now() + 1000 },
    ];
    for (const [k, change] of changes.entries())
      await t.run(async (ctx) => {
        const thread = (await createAppContext(ctx.db).threads.findById(threadIds[k]!))!;
        const r = recording(ctx.db);
        await createAppContext(r.db).threads.update({ ...thread, ...change });
        expect(r.queries).toContain("commentThreads");
      });
    await expectDerivedMatchesThreads(t, workId, revisionId);
  });

  it("実際の操作（投稿・返信・リアクション・採否・削除）のあとも、件数と要約は数え直した値と同じ", async () => {
    const t = createHarness();
    const { cast, workId, revisionId, threadIds } = await seed(t);
    await cast.creator.as.mutation(api.comments.reply, {
      threadId: threadIds[0]!,
      body: "直します",
    });
    await expectDerivedMatchesThreads(t, workId, revisionId);
    await cast.creator.as.mutation(api.comments.toggleReaction, {
      threadId: threadIds[0]!,
      emoji: "👍",
    });
    await expectDerivedMatchesThreads(t, workId, revisionId);
    await cast.creator.as.mutation(api.comments.decide, {
      threadId: threadIds[0]!,
      action: "resolved",
    });
    await expectDerivedMatchesThreads(t, workId, revisionId);
    await cast.reviewer.as.mutation(api.comments.remove, { threadId: threadIds[1]! });
    await expectDerivedMatchesThreads(t, workId, revisionId);
    expect(await t.run((ctx) => ctx.db.get(revisionId))).toMatchObject({
      unresolvedCount: 1,
      threadCount: 2,
    });
  });
});

describe("まとめて足すスレッド（自動校正・企画情報の確認）は、最後に 1 回だけ数え直す", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("5 件足しても、版のスレッドを読むのは 1 回。件数・要約は全部を数え直した値と同じ", async () => {
    const t = createHarness();
    const { workId, revisionId } = await seed(t);
    const counts = await t.run(async (ctx) => {
      const rec = recording(ctx.db);
      const app = createAppContext(rec.db);
      const now = Date.now();
      const created = await app.threads.insertMany(
        ["a", "b", "c", "d", "e"].map((body) => ({
          revisionId,
          authorId: "bot:proofreader",
          body,
          kind: "correction" as const,
          severity: "minor" as const,
          resolution: "open" as const,
          createdAt: now,
        })),
      );
      return {
        created: created.length,
        ids: created.every((c) => typeof c.id === "string"),
        threadQueries: rec.queries.filter((q) => q === "commentThreads").length,
      };
    });
    expect(counts).toEqual({ created: 5, ids: true, threadQueries: 1 });
    await expectDerivedMatchesThreads(t, workId, revisionId);
  });

  it("0 件なら何も読まない・書かない", async () => {
    const t = createHarness();
    await seed(t);
    const rec = await t.run(async (ctx) => {
      const r = recording(ctx.db);
      await createAppContext(r.db).threads.insertMany([]);
      return { queries: r.queries.length, writes: r.writes.length };
    });
    expect(rec).toEqual({ queries: 0, writes: 0 });
  });
});
