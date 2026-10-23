import { describe, expect, it } from "vite-plus/test";
import { finalizeWork } from "../usecases/approvals.ts";
import { grantWorkPermission } from "../usecases/acl.ts";
import { decideThread, postComment } from "../usecases/comments.ts";
import { buildDashboard } from "../usecases/dashboard.ts";
import { listSubmitTargets, setWorkPinned } from "../usecases/home.ts";
import { assignReviewers, closeExpiredReviews } from "../usecases/reviews.ts";
import { changeWorkLifecycle } from "../usecases/works.ts";
import { createInMemoryContext, type InMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const DAY = 24 * HOUR;

/** 受付中・期限で受付終了・未提出・校了者 2 人・保留を 1 つずつ。ピン留めと専門確認も入れる */
async function seedPortfolio() {
  const ctx = createInMemoryContext();
  const now = ctx.clock.now();
  const reviewing = await seedWork(ctx, { title: "受付中", deadlineAt: now + 5 * DAY });
  const lapsed = await seedWork(ctx, { title: "受付終了" });
  const unsubmitted = await seedWork(ctx, { title: "未提出", deadlineAt: now + 30 * DAY });
  const quorum = await seedWork(ctx, {
    title: "校了者 2 人",
    approverIds: [principals.approver.userId, principals.manager.userId],
    approvalQuorum: 2,
  });
  const held = await seedWork(ctx, { title: "保留" });

  const open = await submitRevision(ctx, reviewing.id, { deadlineInHours: 48 });
  const late = await submitRevision(ctx, lapsed.id, { deadlineInHours: 1 });
  const quorumRevision = await submitRevision(ctx, quorum.id, { deadlineInHours: 48 });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: reviewing.id,
    principalType: "user",
    principalId: principals.reviewer.userId,
    permission: "review",
  });
  await assignReviewers(ctx, principals.manager, {
    revisionId: open.id,
    reviewerIds: [principals.reviewer.userId],
    reviewType: "general",
  });
  for (const [revisionId, body] of [
    [open.id, "誤字"],
    [open.id, "表記ゆれ"],
    [late.id, "数字"],
  ] as const)
    await postComment(ctx, principals.manager, {
      revisionId,
      body,
      kind: "correction",
      severity: "major",
    });
  const [first] = await ctx.threads.listByRevision(open.id);
  await decideThread(ctx, principals.creator, { threadId: first!.id, action: "resolved" });
  await ctx.checks.insert({
    revisionId: open.id,
    type: "photo",
    label: "写真",
    assigneeId: principals.reviewer.userId,
    state: "pending",
  });
  await finalizeWork(ctx, principals.approver, {
    workId: quorum.id,
    revisionId: quorumRevision.id,
  });
  await changeWorkLifecycle(ctx, principals.manager, { workId: held.id, to: "on_hold" });
  for (const w of [reviewing, lapsed, held])
    await setWorkPinned(ctx, principals.creator, { workId: w.id, pinned: true });

  ctx.clock.advance(2 * HOUR);
  await closeExpiredReviews(ctx, 10);
  const works = async () =>
    Promise.all(
      [reviewing, lapsed, unsubmitted, quorum, held].map(
        async (w) => (await ctx.works.findById(w.id))!,
      ),
    );
  return { ctx, works };
}

function withoutSummaries(ctx: InMemoryContext) {
  ctx.workSummaries.findByWork = async () => null;
}

function countReads(ctx: InMemoryContext) {
  const calls = { revisions: 0, threads: 0 };
  const revisions = ctx.revisions.listByWork.bind(ctx.revisions);
  ctx.revisions.listByWork = (id) => {
    calls.revisions++;
    return revisions(id);
  };
  const threads = ctx.threads.listByRevision.bind(ctx.threads);
  ctx.threads.listByRevision = (id) => {
    calls.threads++;
    return threads(id);
  };
  return calls;
}

const viewers = [
  principals.creator,
  principals.manager,
  principals.reviewer,
  principals.approver,
] as const;

describe("制作物の要約（workSummaries）", () => {
  it("要約があってもなくても、ダッシュボードと提出先の候補は同じ", async () => {
    const withSummary = await seedPortfolio();
    const fallback = await seedPortfolio();
    withoutSummaries(fallback.ctx);
    for (const who of viewers) {
      const expected = await buildDashboard(fallback.ctx, who, await fallback.works());
      expect(await buildDashboard(withSummary.ctx, who, await withSummary.works())).toEqual(
        expected,
      );
      expect(
        await listSubmitTargets(withSummary.ctx, who, await withSummary.works(), {
          creatorOnly: false,
          includeAccepting: false,
        }),
      ).toEqual(
        await listSubmitTargets(fallback.ctx, who, await fallback.works(), {
          creatorOnly: false,
          includeAccepting: false,
        }),
      );
    }
    const manager = await buildDashboard(fallback.ctx, principals.manager, await fallback.works());
    expect(manager.overview.threads).toEqual({ open: 2, done: 1 });
    expect(manager.overview.stages).toMatchObject({ reviewing: 2, lapsed: 1, unsubmitted: 1 });
  });

  it("要約が揃っていれば、ダッシュボードと提出先の候補は版の全件とスレッドを読まない", async () => {
    const { ctx, works } = await seedPortfolio();
    const calls = countReads(ctx);
    const dashboard = await buildDashboard(ctx, principals.creator, await works());
    expect(dashboard.pinned).toHaveLength(3);
    expect(dashboard.mine.submit.length).toBeGreaterThan(0);
    expect(calls).toEqual({ revisions: 0, threads: 0 });

    withoutSummaries(ctx);
    await buildDashboard(ctx, principals.creator, await works());
    expect(calls.revisions).toBeGreaterThan(0);
    expect(calls.threads).toBeGreaterThan(0);
  });
});
