import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { WithoutSystemFields } from "convex/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { createCast, createHarness, HOUR, uploadVerified, type Harness } from "../test/harness";
import { profileReads } from "../test/readProfile";
import { setupWork, submitFiles } from "../test/flows";
import { syncWorkSummary, WORK_SUMMARY_VERSION } from "./lib/workSummary";

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
      dashboard: await who.as.query(internal.dashboard.get, {}),
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
      // 一覧の行（workListCards）が無い古い制作物も、要約から・版から同じ値を返す
      for (const row of await ctx.db.query("workListCards").collect()) await ctx.db.delete(row._id);
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

  it("一覧の行（workListCards）は、書込みのたびに要約から作り直され、いつでも要約の値と一致する", async () => {
    const t = createHarness();
    const cast = await seed(t);
    // 受付中の版を閉じ、新しい版を出し、校了の宣言の数が変わる書込みを通す
    const check = async () =>
      t.run(async (ctx) => {
        const cards = await ctx.db.query("workListCards").collect();
        const summaries = await ctx.db.query("workSummaries").collect();
        expect(cards).toHaveLength(summaries.length);
        for (const s of summaries) {
          const c = cards.find((x) => x.workId === s.workId)!;
          expect(c).toMatchObject({
            latestLabel: s.latest?.label ?? null,
            acceptingId: s.accepting?.id ?? null,
            acceptingDeadlineAt: s.accepting?.deadlineAt ?? null,
            acceptingReviewUrgent: s.accepting?.reviewUrgent === true,
            declared: s.declared,
          });
        }
      });
    await check();
    const list = await cast.manager.as.query(api.works.listMine, {});
    const open = list.find((w) => w.title === "受付中")!;
    vi.setSystemTime(Date.now() + HOUR);
    await submitFiles(cast, open.id, pdf);
    await check();
    expect(
      (await cast.manager.as.query(api.works.listMine, {})).find((w) => w.id === open.id)
        ?.latestRevisionLabel,
    ).toBe("第2版");
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

  it("版が古い・項目の欠けた要約は信じず、一覧・ダッシュボード・提出先は版から数え直した値を返す", async () => {
    const t = createHarness();
    const cast = await seed(t);
    const current = await readAll(cast);
    const rows = await t.run((ctx) => ctx.db.query("workSummaries").collect());
    // 一覧は一覧の行（workListCards）があると要約を読まない
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workListCards").collect()) await ctx.db.delete(row._id);
    });
    // 信じれば一覧・ダッシュボードの値が変わる中身。項目が 1 つでも欠けた行は、残りの項目も信じない
    const wrong = {
      latest: null,
      accepting: null,
      threads: { unresolved: 9, total: 9, lastCreatedAt: null },
    };
    const variants: Array<Record<string, unknown>> = [
      { ...wrong, summaryVersion: undefined },
      { ...wrong, summaryVersion: WORK_SUMMARY_VERSION - 1 },
      { ...wrong, latest: undefined },
      { ...wrong, accepting: undefined },
      { ...wrong, threads: undefined },
    ];
    for (const variant of variants) {
      await t.run(async (ctx) => {
        for (const { _id, _creationTime, ...fields } of rows) {
          void _creationTime;
          const next: Record<string, unknown> = { ...fields, ...variant };
          for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
          await ctx.db.replace(_id, next as WithoutSystemFields<Doc<"workSummaries">>);
        }
      });
      expect(await readAll(cast)).toEqual(current);
    }
  });

  it("埋め直しの移行（backfillWorkSummaries）は、id だけの古い行を今の要約に作り直す", async () => {
    const t = createHarness();
    await seed(t);
    const fields = () =>
      t.run(async (ctx) =>
        (await ctx.db.query("workSummaries").collect()).map(({ _id, _creationTime, ...rest }) => {
          void [_id, _creationTime];
          return rest;
        }),
      );
    const want = await fields();
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workSummaries").collect())
        await ctx.db.replace(row._id, {
          workId: row.workId,
          latestId: row.latestId,
          acceptingId: row.acceptingId,
          declared: row.declared,
        });
    });
    await t.mutation(internal.migrations.backfillWorkSummaries, {
      cursor: null,
      oneBatchOnly: true,
    });
    expect(await fields()).toEqual(want);
  });

  it("要約・一覧の行・進み具合の値が変わらない書込み（題名の変更）は、それらを書き直さない", async () => {
    const t = createHarness();
    const cast = await seed(t);
    for (const work of await cast.manager.as.query(api.works.listMine, {})) {
      const run = await profileReads(() =>
        cast.manager.as.mutation(api.works.update, {
          workId: work.id,
          patch: { title: `${work.title}（改題）` },
        }),
      );
      expect(run.writes.works).toBeGreaterThan(0);
      expect(run.writes.workSummaries).toBeUndefined();
      expect(run.writes.workListCards).toBeUndefined();
      expect(run.writes.workProgress).toBeUndefined();
    }
  });

  it("指摘の書込みは、一覧の行と進み具合を読まず書かない", async () => {
    const t = createHarness();
    const cast = await seed(t);
    const reviewing = (await cast.manager.as.query(api.works.listMine, {})).find(
      (w) => w.title === "受付中",
    )!;
    const run = await profileReads(() =>
      cast.reviewer.as.mutation(api.comments.post, {
        revisionId: reviewing.acceptingRevisionId as Id<"revisions">,
        body: "句読点",
        kind: "correction",
        severity: "minor",
      }),
    );
    expect(run.writes.workSummaries).toBe(1);
    expect(run.byTable.workListCards).toBeUndefined();
    expect(run.byTable.workProgress).toBeUndefined();
  });

  it("緊急の版を受け付けている制作物は、一覧の行からでも要約からでも緊急と出る", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { title: "緊急" });
    const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
      workId,
      kind: "standard",
      reviewType: "general",
      reviewUrgent: true,
      deadlineAt: Date.now() + 6 * HOUR,
      changeSummary: "急ぎ",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
    });
    await uploadVerified(cast.creator, prepared.items[0]!.id, { size: 10, sha256: "a" });
    await cast.creator.as.mutation(api.submissions.confirm, {
      sessionId: prepared.sessionId as Id<"uploadSessions">,
    });
    const urgent = async () =>
      (await cast.manager.as.query(api.works.listMine, {})).find((w) => w.id === workId)
        ?.acceptingReviewUrgent;
    expect(await urgent()).toBe(true);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workListCards").collect()) await ctx.db.delete(row._id);
    });
    expect(await urgent()).toBe(true);
  });

  it("校了の宣言を数えない制作物（校了者 1 人で校了した）は、要約を作り直すときに校了の履歴を読まない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const { revisionId } = await submitFiles(cast, workId, pdf);
    await cast.approver.as.mutation(api.approvals.finalize, { workId, revisionId });
    const events = await t.run((ctx) => ctx.db.query("approvalEvents").collect());
    expect(events.length).toBeGreaterThan(0);
    const run = await profileReads(() => t.run((ctx) => syncWorkSummary(ctx.db, workId)));
    expect(run.byTable.approvalEvents).toBeUndefined();
  });

  it("制作物が無ければ、要約を作り直しても何も書かない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    await t.run((ctx) => ctx.db.delete(workId));
    const run = await profileReads(() => t.run((ctx) => syncWorkSummary(ctx.db, workId)));
    expect(run.writes).toEqual({});
  });
});
