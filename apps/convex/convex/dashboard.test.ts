import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

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
    await cast.manager.as.mutation(api.reviews.assign, {
      revisionId,
      reviewerIds: [cast.reviewer.id],
      reviewType: "general",
    });
    await cast.reviewer.as.mutation(api.comments.post, {
      revisionId,
      body: "誤字",
      kind: "correction",
      severity: "major",
    });
    await cast.creator.as.mutation(api.home.setPinned, { workId, pinned: true });

    for (const who of [cast.creator, cast.manager, cast.reviewer, cast.approver, cast.stranger]) {
      const full = await who.as.query(api.dashboard.get, {});
      const { review, checks, finalize, assign } = full.mine;
      expect(await who.as.query(api.dashboard.check, {})).toEqual({
        mine: { review, checks, finalize, assign },
        done: full.done,
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
  });
});

describe("Convex 統合: 校正のナビのバッジ", () => {
  it("自分の未完了の割当と専門確認を数え、受付が終わった版の割当は数えない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    expect(await cast.reviewer.as.query(api.dashboard.checkBadge, {})).toEqual({ count: 0 });

    const assign = async (workId: Parameters<typeof submitFiles>[1]) => {
      const { revisionId } = await submitFiles(cast, workId, pdf);
      await cast.manager.as.mutation(api.reviews.assign, {
        revisionId,
        reviewerIds: [cast.reviewer.id],
        reviewType: "general",
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
