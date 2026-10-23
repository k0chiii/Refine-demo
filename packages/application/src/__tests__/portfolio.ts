import { finalizeWork } from "../usecases/approvals.ts";
import { grantWorkPermission } from "../usecases/acl.ts";
import { decideThread, postComment } from "../usecases/comments.ts";
import { setWorkPinned } from "../usecases/home.ts";
import { setWorkReviewers } from "../usecases/reviewers.ts";
import { closeExpiredReviews } from "../usecases/reviews.ts";
import { changeWorkLifecycle } from "../usecases/works.ts";
import { createInMemoryContext, type InMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const DAY = 24 * HOUR;

/** 受付中・期限で受付終了・未提出・校了者 2 人・保留を 1 つずつ。ピン留めと専門確認も入れる */
export async function seedPortfolio() {
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
    userIds: [principals.reviewer.userId],
    permission: "review",
  });
  await setWorkReviewers(ctx, principals.manager, {
    workId: reviewing.id,
    reviewerIds: [principals.reviewer.userId],
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

export function withoutSummaries(ctx: InMemoryContext) {
  ctx.workSummaries.findByWork = async () => null;
}

export const viewers = [
  principals.creator,
  principals.manager,
  principals.reviewer,
  principals.approver,
] as const;
