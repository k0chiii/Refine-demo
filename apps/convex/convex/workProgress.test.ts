import { workProgressOf } from "@mf100/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, createUser, HOUR, type Harness } from "../test/harness";
import { profileReads } from "../test/readProfile";
import { setupWork, submitFiles } from "../test/flows";
import { createAppContext } from "./lib/adapters";
import { syncWorkSummary } from "./lib/workSummary";

const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

type Cast = Awaited<ReturnType<typeof createCast>>;

/** 受付中の版の割当・専門確認から数え直した値（書込みの経路を使わず、表を直接読む） */
async function recount(t: Harness, workId: Id<"works">) {
  return t.run(async (ctx) => {
    const revisions = await ctx.db
      .query("revisions")
      .withIndex("by_work", (q) => q.eq("workId", workId))
      .collect();
    const accepting = revisions.find((r) => r.reviewState === "open") ?? null;
    const assignments = accepting
      ? await ctx.db
          .query("reviewAssignments")
          .withIndex("by_revision", (q) => q.eq("revisionId", accepting._id))
          .collect()
      : [];
    const checks = accepting
      ? await ctx.db
          .query("requiredChecks")
          .withIndex("by_revision", (q) => q.eq("revisionId", accepting._id))
          .collect()
      : [];
    return { acceptingId: accepting?._id ?? null, ...workProgressOf({ assignments, checks }) };
  });
}

async function stored(t: Harness, workId: Id<"works">) {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query("workProgress")
      .withIndex("by_work", (q) => q.eq("workId", workId))
      .unique();
    if (!row) return null;
    const { _id, _creationTime, workId: _w, ...rest } = row;
    void [_id, _creationTime, _w];
    return rest;
  });
}

async function readAll(cast: Cast) {
  const out = [];
  for (const who of [cast.creator, cast.manager, cast.reviewer, cast.approver])
    out.push({
      works: await who.as.query(api.dashboard.works, {}),
      check: await who.as.query(api.dashboard.check, {}),
      make: await who.as.query(api.dashboard.make, {}),
      all: await who.as.query(internal.dashboard.get, {}),
    });
  return out;
}

describe("受付中の版の校正の進み具合（workProgress）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function scenario(t: Harness) {
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { title: "進み具合" });
    const first = await submitFiles(cast, workId, pdf);
    const check = async () => expect(await stored(t, workId)).toEqual(await recount(t, workId));
    await check();
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.reviewer.id, cast.stranger.id],
    });
    await check();
    await cast.manager.as.mutation(api.checks.add, {
      revisionId: first.revisionId,
      type: "photo",
      assigneeId: cast.reviewer.id,
    });
    await check();
    expect(await stored(t, workId)).toMatchObject({
      reviewers: { total: 2, done: 0 },
      checks: { total: 1, pending: 1 },
    });
    await cast.reviewer.as.mutation(api.reviews.complete, { revisionId: first.revisionId });
    await check();
    // 名簿から外す（未完了の割当が消える）
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.reviewer.id],
    });
    await check();
    // 新しい版を出すと、前の版は受付が終わり、数える先が新しい版に移る
    vi.setSystemTime(Date.now() + HOUR);
    const second = await submitFiles(cast, workId, pdf);
    await check();
    expect((await stored(t, workId))?.acceptingId).toBe(second.revisionId);
    // 期限で受付が終われば受付中の版が無く、全部 0
    vi.setSystemTime(Date.now() + 49 * HOUR);
    await t.mutation(internal.revisions.closeExpired, {});
    await check();
    expect(await stored(t, workId)).toEqual({
      acceptingId: null,
      reviewers: { total: 0, done: 0 },
      checks: { total: 0, pending: 0 },
    });
    return { cast, workId };
  }

  it("書込みのたびに作り直され、いつでも数え直した値と同じ", async () => {
    const t = createHarness();
    await scenario(t);
  });

  it("行が消えていても、別の版の分（古い）でも、進み具合の無かった頃と同じ結果を返す", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { title: "進み具合" });
    const { revisionId } = await submitFiles(cast, workId, pdf);
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.reviewer.id],
    });
    await cast.manager.as.mutation(api.checks.add, {
      revisionId,
      type: "photo",
      assigneeId: cast.reviewer.id,
    });
    const current = await readAll(cast);
    expect(current[1]!.works.overview.reviewers).toEqual({ total: 1, done: 0 });
    expect(current[1]!.works.overview.checksPending).toBe(1);

    // 行が無い（埋める前）
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workProgress").collect()) await ctx.db.delete(row._id);
    });
    expect(await readAll(cast)).toEqual(current);

    // 数えた版が今の受付中の版と違う（取りこぼし）。信じず数え直す
    await t.run(async (ctx) => {
      await ctx.db.insert("workProgress", {
        workId,
        acceptingId: "somewhere-else",
        reviewers: { total: 99, done: 99 },
        checks: { total: 99, pending: 99 },
      });
    });
    expect(await readAll(cast)).toEqual(current);
  });

  it("埋め直しの移行（backfillWorkSummaries。syncWorkSummary）で、消えた行が元に戻る", async () => {
    const t = createHarness();
    const { workId } = await scenario(t);
    const want = await stored(t, workId);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workProgress").collect()) await ctx.db.delete(row._id);
      await syncWorkSummary(ctx.db, workId);
    });
    expect(await stored(t, workId)).toEqual(want);
  });

  it("受付中でない版の割当を書いても、受付中の版の数は変わらない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const first = await submitFiles(cast, workId, pdf);
    vi.setSystemTime(Date.now() + HOUR);
    const second = await submitFiles(cast, workId, pdf);
    const before = await stored(t, workId);
    await t.run(async (ctx) => {
      const app = createAppContext(ctx);
      await app.assignments.upsert({
        revisionId: first.revisionId,
        reviewerId: cast.reviewer.id,
        reviewType: "general",
        state: "pending",
      });
    });
    expect(await stored(t, workId)).toEqual(before);
    expect(before?.acceptingId).toBe(second.revisionId);
  });

  /** 名簿に校正者を n 人載せる（制作物の準備と、人数ぶんの利用者） */
  async function rosterOf(t: Harness, n: number) {
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const { revisionId } = await submitFiles(cast, workId, pdf);
    const reviewers = [];
    for (let i = 0; i < n; i++) reviewers.push(await createUser(t, `r${n}-${i}`));
    return { cast, workId, revisionId, reviewers };
  }

  it("確認中に変わるだけ（pending → viewed）の書込みは、進み具合の行も他の校正者の割当も読まず書かない", async () => {
    const reads = [];
    for (const n of [2, 12]) {
      const t = createHarness();
      const { cast, workId, revisionId, reviewers } = await rosterOf(t, n);
      await cast.manager.as.mutation(api.reviews.setReviewers, {
        workId,
        reviewerIds: reviewers.map((r) => r.id),
      });
      const before = await stored(t, workId);
      const viewed = await profileReads(() =>
        reviewers[0]!.as.mutation(api.revisions.markViewed, { revisionId }),
      );
      // 割当の書込みは本人の 1 行だけ。進み具合の行は読みも書きもしない
      expect(viewed.writes).toEqual({ reviewAssignments: 1 });
      expect(viewed.byTable.workProgress).toBeUndefined();
      reads.push(viewed.byTable.reviewAssignments?.docs);
      expect(await stored(t, workId)).toEqual(before);
      expect(await stored(t, workId)).toEqual(await recount(t, workId));
    }
    // 校正者が 2 人でも 12 人でも、読む割当の数は同じ（他の人の行は読まない）
    expect(reads[1]).toBe(reads[0]);
    expect(reads[0]).toBeLessThanOrEqual(2);
  });

  it("確認中 → 完了は完了の数だけ足し、専門確認も数が動くときだけ行を書く", async () => {
    const t = createHarness();
    const { cast, workId, revisionId, reviewers } = await rosterOf(t, 3);
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: reviewers.map((r) => r.id),
    });
    await reviewers[0]!.as.mutation(api.revisions.markViewed, { revisionId });
    const done = await profileReads(() =>
      reviewers[0]!.as.mutation(api.reviews.complete, { revisionId }),
    );
    expect(done.writes.workProgress).toBe(1);
    expect(await stored(t, workId)).toMatchObject({ reviewers: { total: 3, done: 1 } });
    expect(await stored(t, workId)).toEqual(await recount(t, workId));

    const checkId = await cast.manager.as.mutation(api.checks.add, {
      revisionId,
      type: "photo",
      assigneeId: reviewers[1]!.id,
    });
    expect(await stored(t, workId)).toMatchObject({ checks: { total: 1, pending: 1 } });
    // 状態が変わらない書込み（メモだけ）は進み具合の行を読まず書かない
    const same = await profileReads(() =>
      t.run(async (ctx) => {
        const app = createAppContext(ctx);
        await app.checks.update({ ...(await app.checks.findById(checkId))!, note: "メモ" });
      }),
    );
    expect(same.writes).toEqual({ requiredChecks: 1 });
    expect(same.byTable.workProgress).toBeUndefined();
    // 完了にすると未完了の数が減る
    await t.run(async (ctx) => {
      const app = createAppContext(ctx);
      await app.checks.update({
        ...(await app.checks.findById(checkId))!,
        state: "done",
        doneBy: reviewers[1]!.id,
      });
    });
    expect(await stored(t, workId)).toMatchObject({ checks: { total: 1, pending: 0 } });
    expect(await stored(t, workId)).toEqual(await recount(t, workId));
  });

  it("名簿に大勢を載せても割当の読み取りは人数に比例し、進み具合は数え直した値と同じ", async () => {
    const readsOf = async (n: number) => {
      const t = createHarness();
      const { cast, workId, reviewers } = await rosterOf(t, n);
      const ids = reviewers.map((r) => r.id);
      const run = await profileReads(() =>
        cast.manager.as.mutation(api.reviews.setReviewers, { workId, reviewerIds: ids }),
      );
      expect(await stored(t, workId)).toEqual(await recount(t, workId));
      expect(await stored(t, workId)).toMatchObject({ reviewers: { total: n, done: 0 } });
      // 一部を外し、一部を完了にしても、行は数え直した値のまま
      await reviewers[0]!.as.mutation(api.reviews.complete, {
        revisionId: (await recount(t, workId)).acceptingId as Id<"revisions">,
      });
      await cast.manager.as.mutation(api.reviews.setReviewers, {
        workId,
        reviewerIds: ids.slice(0, n - 10),
      });
      expect(await stored(t, workId)).toEqual(await recount(t, workId));
      expect(await stored(t, workId)).toMatchObject({ reviewers: { total: n - 10, done: 1 } });
      return run.byTable.reviewAssignments?.docs ?? 0;
    };
    const small = await readsOf(30);
    const large = await readsOf(60);
    // 1 人あたり定数（以前は 1 人追加するたびに全員を数え直したので 2 乗で増えた）
    expect(small).toBeLessThanOrEqual(2 * 30);
    expect(large).toBeLessThanOrEqual(2 * 60);
    expect(large).toBeLessThanOrEqual(2.5 * small);
  });

  it("進み具合の行が無いときの割当の書込みは、割当・専門確認から作り直して数え直した値になる", async () => {
    const t = createHarness();
    const { cast, workId, revisionId, reviewers } = await rosterOf(t, 4);
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: reviewers.slice(0, 3).map((r) => r.id),
    });
    await cast.manager.as.mutation(api.checks.add, { revisionId, type: "photo" });
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("workProgress").collect()) await ctx.db.delete(row._id);
    });
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: reviewers.map((r) => r.id),
    });
    expect(await stored(t, workId)).toEqual(await recount(t, workId));
    expect(await stored(t, workId)).toMatchObject({
      reviewers: { total: 4, done: 0 },
      checks: { total: 1, pending: 1 },
    });
  });
});
