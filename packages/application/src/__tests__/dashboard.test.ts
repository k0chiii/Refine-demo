import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { decideThread, postComment } from "../usecases/comments.ts";
import { buildDashboard, dashboardPolicy } from "../usecases/dashboard.ts";
import { assignReviewers, closeExpiredReviews, completeMyReview } from "../usecases/reviews.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

async function setup() {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx, { deadlineAt: ctx.clock.now() + 10 * 86_400_000 });
  const revision = await submitRevision(ctx, work.id, { deadlineInHours: 24 });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: work.id,
    principalType: "user",
    principalId: principals.reviewer.userId,
    permission: "review",
  });
  const works = async () => [(await ctx.works.findById(work.id))!];
  return { ctx, work, revision, works };
}

describe("ダッシュボード（あなたの担当・溜まっているもの）", () => {
  it("割当前: 主管には「割り当てる」、校正者には何も出ない。未割当は溜まっているものにも出る", async () => {
    const { ctx, works, revision } = await setup();
    const manager = await buildDashboard(ctx, principals.manager, await works());
    expect(manager.mine.assign.map((i) => i.revisionId)).toEqual([revision.id]);
    expect(manager.backlog.unassigned).toHaveLength(1);
    expect(manager.backlog.dueSoon).toHaveLength(1); // 納期 10 日後 ≤ 14 日
    const reviewer = await buildDashboard(ctx, principals.reviewer, await works());
    expect(reviewer.mine.review).toHaveLength(0);
    expect(reviewer.mine.assign).toHaveLength(0);
  });

  it("割当後: 校正者に「校正する」。確認を完了すると消える", async () => {
    const { ctx, works, revision } = await setup();
    await assignReviewers(ctx, principals.manager, {
      revisionId: revision.id,
      reviewerIds: [principals.reviewer.userId],
      reviewType: "general",
    });
    let d = await buildDashboard(ctx, principals.reviewer, await works());
    expect(d.mine.review.map((i) => i.revisionLabel)).toEqual(["第1版"]);
    expect((await buildDashboard(ctx, principals.manager, await works())).mine.assign).toHaveLength(
      0,
    );
    await completeMyReview(ctx, principals.reviewer, revision.id);
    d = await buildDashboard(ctx, principals.reviewer, await works());
    expect(d.mine.review).toHaveLength(0);
  });

  it("未対応の指摘があると制作者に「返事をする」、無くなると校了権限者に「校了する」", async () => {
    const { ctx, works, revision } = await setup();
    await assignReviewers(ctx, principals.manager, {
      revisionId: revision.id,
      reviewerIds: [principals.reviewer.userId],
      reviewType: "general",
    });
    expect(
      (await buildDashboard(ctx, principals.approver, await works())).mine.finalize,
    ).toHaveLength(1);
    const thread = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "誤字",
      kind: "correction",
      severity: "major",
    });
    const creator = await buildDashboard(ctx, principals.creator, await works());
    expect(creator.mine.respond).toHaveLength(1);
    expect(creator.mine.respond[0]!.count).toBe(1);
    expect(
      (await buildDashboard(ctx, principals.approver, await works())).mine.finalize,
    ).toHaveLength(0);
    await decideThread(ctx, principals.creator, { threadId: thread.id, action: "resolved" });
    expect(
      (await buildDashboard(ctx, principals.creator, await works())).mine.respond,
    ).toHaveLength(0);
    expect(
      (await buildDashboard(ctx, principals.approver, await works())).mine.finalize,
    ).toHaveLength(1);
  });

  it("期限到来で受付が終わり次の版が無いと「期限超過」、長く動きがないと「動きなし」", async () => {
    const { ctx, works, revision } = await setup();
    ctx.clock.current = revision.deadlineAt + HOUR;
    await closeExpiredReviews(ctx, 10);
    let d = await buildDashboard(ctx, principals.creator, await works());
    expect(d.backlog.overdue.map((i) => i.revisionId)).toEqual([revision.id]);
    expect(d.backlog.stale).toHaveLength(0);
    ctx.clock.current = revision.submittedAt + dashboardPolicy.staleAfterMs;
    d = await buildDashboard(ctx, principals.creator, await works());
    expect(d.backlog.stale).toHaveLength(1);
  });

  it("閲覧権限の無い人には何も出ない（非公開の制作物）", async () => {
    const { ctx, works } = await setup();
    for (const w of await works()) await ctx.works.update({ ...w, confidentiality: "restricted" });
    const d = await buildDashboard(ctx, principals.stranger, await works());
    expect(
      [...Object.values(d.mine), ...Object.values(d.backlog)].every((l) => l.length === 0),
    ).toBe(true);
  });
});
