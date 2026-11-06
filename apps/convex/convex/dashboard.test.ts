import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";
import { principalOf } from "./lib/principal";
import { syncWorkSummary } from "./lib/workSummary";
import { listWorksRelatedTo } from "./works";

const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

describe("Convex 統合: ダッシュボードの節ごとの問い合わせ", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("校正・制作・制作物の節は、全部入りのダッシュボードの該当の節と同じ", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { title: "A" });
    const { revisionId } = await submitFiles(cast, workId, pdf);
    await setupWork(t, cast, { title: "B" });
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.reviewer.id],
    });
    // 職責の無い人に edit の許可だけがある制作物（割り当てる・採否を決められる）と、
    // 専門確認の担当だけがある制作物。どちらも全件を読まずに候補に入ること
    const granted = await setupWork(t, cast, { title: "C" });
    await submitFiles(cast, granted, pdf);
    await cast.admin.as.mutation(api.acl.grant, {
      workId: granted,
      userIds: [cast.stranger.id],
      permission: "edit",
    });
    const checked = await setupWork(t, cast, { title: "D" });
    const { revisionId: checkedRevision } = await submitFiles(cast, checked, pdf);
    await t.run(async (ctx) => {
      await ctx.db.insert("requiredChecks", {
        revisionId: checkedRevision,
        type: "photo",
        label: "写真",
        assigneeId: cast.approver.id,
        state: "pending",
      });
    });
    await cast.reviewer.as.mutation(api.comments.post, {
      revisionId,
      body: "誤字",
      kind: "correction",
      severity: "major",
    });
    await cast.creator.as.mutation(api.home.setPinned, { workId, pinned: true });

    for (const who of [
      cast.admin,
      cast.creator,
      cast.manager,
      cast.reviewer,
      cast.approver,
      cast.stranger,
    ]) {
      const full = await who.as.query(api.dashboard.get, {});
      const { review, checks, finalize, assign } = full.mine;
      const rows = new Set(
        [...review, ...checks, ...finalize, ...assign, ...full.done].map((i) => i.workId),
      );
      expect(await who.as.query(api.dashboard.check, {})).toEqual({
        mine: { review, checks, finalize, assign },
        done: full.done,
        pinned: full.pinned.filter((i) => !rows.has(i.workId)),
      });
      expect(await who.as.query(api.dashboard.make, {})).toEqual({
        submit: full.mine.submit,
        respond: full.mine.respond.filter((i) =>
          full.overview.works.some((r) => r.workId === i.workId && r.isCreator),
        ),
        works: full.overview.works.filter((r) => r.isCreator),
        mentions: full.mentions,
      });
      expect(await who.as.query(api.dashboard.works, {})).toEqual({
        pinned: full.pinned,
        backlog: full.backlog,
        nextDeadline: full.nextDeadline,
        summary: { dueSoon: full.summary.dueSoon, overdue: full.summary.overdue },
        overview: full.overview,
      });
    }
    const reviewer = await cast.reviewer.as.query(api.dashboard.check, {});
    expect(reviewer.mine.review.map((i) => i.workId)).toEqual([workId]);
    const creator = await cast.creator.as.query(api.dashboard.make, {});
    expect(creator.respond.map((i) => i.workId)).toEqual([workId]);
    expect(creator.mentions.length).toBeGreaterThan(0);
    expect((await cast.creator.as.query(api.dashboard.works, {})).pinned).toHaveLength(1);
    expect((await cast.creator.as.query(api.dashboard.check, {})).pinned).toHaveLength(1);
    const stranger = await cast.stranger.as.query(api.dashboard.check, {});
    expect(stranger.mine.assign.map((i) => i.workId)).toEqual([granted]);
    const approver = await cast.approver.as.query(api.dashboard.check, {});
    expect(approver.mine.checks.map((i) => i.workId)).toEqual([checked]);
  });
});

describe("Convex 統合: 校正・制作の節の候補は、職責・割当・許可の索引から読む", () => {
  it("関係のない制作物は候補に入らない（全件を読まない）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const mine = await setupWork(t, cast, { title: "割り当てられた" });
    const { revisionId } = await submitFiles(cast, mine, pdf);
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId: mine,
      reviewerIds: [cast.reviewer.id],
    });
    for (const title of ["関係ない1", "関係ない2"]) await setupWork(t, cast, { title });
    const titles = await t.run(async (ctx) => {
      const reviewer = principalOf((await ctx.db.get(cast.reviewer.id))!);
      const check = await listWorksRelatedTo(ctx.db, reviewer, { assignments: true });
      const make = await listWorksRelatedTo(ctx.db, reviewer, { assignments: false });
      return { check: check.map((w) => w.title), make: make.map((w) => w.title) };
    });
    expect(titles.check).toEqual(["割り当てられた"]);
    expect(titles.make).toEqual([]);
    // 版の受付が終われば、割当があっても候補にしない
    await t.run(async (ctx) => {
      await ctx.db.patch(revisionId, { reviewState: "closed" });
      await syncWorkSummary(ctx.db, mine);
    });
    const after = await t.run(async (ctx) => {
      const reviewer = principalOf((await ctx.db.get(cast.reviewer.id))!);
      return (await listWorksRelatedTo(ctx.db, reviewer, { assignments: true })).length;
    });
    expect(after).toBe(0);
  });
});

describe("Convex 統合: 校正のナビのバッジ", () => {
  it("自分の未完了の割当と専門確認を数え、受付が終わった版の割当は数えない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    expect(await cast.reviewer.as.query(api.dashboard.checkBadge, {})).toEqual({ count: 0 });

    const assign = async (workId: Parameters<typeof submitFiles>[1]) => {
      const { revisionId } = await submitFiles(cast, workId, pdf);
      await cast.manager.as.mutation(api.reviews.setReviewers, {
        workId,
        reviewerIds: [cast.reviewer.id],
      });
      return revisionId;
    };
    // 受付中の割当 2 件（うち 1 件の版には自分担当の専門確認が 1 件）
    const first = await assign(await setupWork(t, cast, { title: "A" }));
    await assign(await setupWork(t, cast, { title: "B" }));
    // 受付が終わった版の割当と専門確認は数えない
    const closed = await assign(await setupWork(t, cast, { title: "C" }));
    await t.run(async (ctx) => {
      await ctx.db.insert("requiredChecks", {
        revisionId: first,
        type: "photo",
        label: "写真",
        assigneeId: cast.reviewer.id,
        state: "pending",
      });
      await ctx.db.insert("requiredChecks", {
        revisionId: closed,
        type: "photo",
        label: "写真",
        assigneeId: cast.reviewer.id,
        state: "pending",
      });
      await ctx.db.patch(closed, { reviewState: "closed" });
    });

    expect(await cast.reviewer.as.query(api.dashboard.checkBadge, {})).toEqual({ count: 3 });
    // 割当の無い人は 0。校正を完了すると減る
    expect(await cast.creator.as.query(api.dashboard.checkBadge, {})).toEqual({ count: 0 });
    await cast.reviewer.as.mutation(api.reviews.complete, { revisionId: first });
    expect(await cast.reviewer.as.query(api.dashboard.checkBadge, {})).toEqual({ count: 2 });
  });
});
