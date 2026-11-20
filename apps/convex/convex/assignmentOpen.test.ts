import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, HOUR, type Harness } from "../test/harness";
import { profileReads } from "../test/readProfile";
import { setupWork, submitFiles } from "../test/flows";

/**
 * 割当の印（reviewAssignments.revisionOpen）が、版の受付状態に沿って書込みの側で揃うこと、
 * 印が無い古い行でも読む側の結果が同じこと、閉じた版の割当を読まないことの確かめ。
 */
const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

async function flags(t: Harness) {
  return t.run(async (ctx) => {
    const rows = await ctx.db.query("reviewAssignments").collect();
    return Object.fromEntries(
      rows.map((r) => [`${r.revisionId}|${r.reviewerId}`, r.revisionOpen ?? null]),
    );
  });
}

/** 版の文書から導いた、あるべき印 */
async function truth(t: Harness) {
  return t.run(async (ctx) => {
    const out: Record<string, boolean> = {};
    for (const r of await ctx.db.query("reviewAssignments").collect())
      out[`${r.revisionId}|${r.reviewerId}`] =
        (await ctx.db.get(r.revisionId))?.reviewState === "open";
    return out;
  });
}

/** 受付中・差し替えられた・期限で終わった・無効にした版を作る（どれも割当あり） */
async function seed(t: Harness) {
  const cast = await createCast(t);
  const assign = (workId: Id<"works">) =>
    cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.reviewer.id, cast.approver.id],
    });
  // 1 件目は 2 版（1 版は差し替えで閉じる）
  const superseded = await setupWork(t, cast, { title: "差し替え" });
  await assign(superseded);
  const v1 = await submitFiles(cast, superseded, pdf);
  vi.setSystemTime(Date.now() + HOUR);
  const v2 = await submitFiles(cast, superseded, pdf);
  // 期限で終わる版
  const lapsed = await setupWork(t, cast, { title: "期限切れ" });
  await assign(lapsed);
  const lapsedRev = await submitFiles(cast, lapsed, pdf);
  // 受付中のまま残る版
  const open = await setupWork(t, cast, { title: "受付中" });
  await assign(open);
  const openRev = await submitFiles(cast, open, pdf);
  // 無効にした版
  const voided = await setupWork(t, cast, { title: "無効" });
  await assign(voided);
  const voidedRev = await submitFiles(cast, voided, pdf);
  await cast.creator.as.mutation(api.submissions.voidRevision, {
    revisionId: voidedRev.revisionId,
    reason: "誤提出",
  });
  return { cast, v1, v2, lapsedRev, openRev, voidedRev, lapsed };
}

describe("Convex 統合: 割当の印（revisionOpen）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("書込みのたびに揃えた印は、版から導いたあるべき印と、作り直した印に一致する", async () => {
    const t = createHarness();
    const w = await seed(t);
    // 期限で終わる版（cron と同じ経路）。ほかの受付中の版は期限の前なので残る
    await t.run(async (ctx) => {
      const rev = await ctx.db.get(w.lapsedRev.revisionId);
      await ctx.db.patch(rev!._id, { deadlineAt: Date.now() - 1 });
    });
    await t.mutation(internal.revisions.closeExpired, {});

    const incremental = await flags(t);
    const expected = await truth(t);
    expect(Object.values(incremental)).toContain(true);
    expect(Object.values(incremental)).toContain(false);
    expect(incremental).toEqual(expected);

    // 印を消して移行（backfillAssignmentOpen）で作り直しても同じ
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("reviewAssignments").collect())
        await ctx.db.patch(r._id, { revisionOpen: undefined });
    });
    await t.mutation(internal.migrations.backfillAssignmentOpen, {
      cursor: null,
      oneBatchOnly: true,
    });
    expect(await flags(t)).toEqual(expected);
  });

  it("版を差し替えると前の版の割当の印は閉じ、校正者を足した割当には版の今の状態が付く", async () => {
    const t = createHarness();
    const { cast, v1, v2 } = await seed(t);
    const state = await flags(t);
    expect(state[`${v1.revisionId}|${cast.reviewer.id}`]).toBe(false);
    expect(state[`${v2.revisionId}|${cast.reviewer.id}`]).toBe(true);
  });

  it("印の無い古い行でも、校正のバッジ・校正の入口・制作物の候補は印のある行と同じ", async () => {
    const t = createHarness();
    const { cast } = await seed(t);
    const read = async () => ({
      badge: await cast.reviewer.as.query(api.dashboard.checkBadge, {}),
      check: await cast.reviewer.as.query(api.dashboard.check, {}),
      badgeApprover: await cast.approver.as.query(api.dashboard.checkBadge, {}),
    });
    const withFlags = await read();
    // 差し替え後の版・期限前の版・受付中の版の 3 件（無効にした版・差し替えられた版は数えない）
    expect(withFlags.badge.count).toBe(3);
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("reviewAssignments").collect())
        await ctx.db.patch(r._id, { revisionOpen: undefined });
    });
    expect(await read()).toEqual(withFlags);
  });

  it("校正のバッジは、閉じた版の割当と、その版の文書を読まない", async () => {
    const t = createHarness();
    const { cast } = await seed(t);
    const { result, byTable } = await profileReads(() =>
      cast.reviewer.as.query(api.dashboard.checkBadge, {}),
    );
    expect(result.count).toBe(3);
    // 読んだのは受付中の版の割当 3 件だけ。閉じた版（差し替え 1・無効 1）の割当も、版・制作物の文書も要約も読まない
    expect(byTable.reviewAssignments?.docs).toBe(3);
    expect(byTable.revisions).toBeUndefined();
    expect(byTable.workSummaries).toBeUndefined();
    expect(byTable.works).toBeUndefined();
  });
});
