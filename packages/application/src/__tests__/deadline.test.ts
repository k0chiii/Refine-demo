import { deadlineFromJst } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { postComment } from "../usecases/comments.ts";
import { listMyNotifications } from "../usecases/notifications.ts";
import {
  assignReviewers,
  closeExpiredReviews,
  remindUpcomingDeadlines,
} from "../usecases/reviews.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

/** JST の壁時計 → epoch ms */
const jst = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);

/** 11/1 9:00 JST に「11/14 締切（日付だけ）」の版を出し、校正者を割り当てる */
async function setup() {
  const ctx = createInMemoryContext(jst(2026, 11, 1, 9));
  const work = await seedWork(ctx);
  const revision = await submitRevision(ctx, work.id, {
    deadlineAt: deadlineFromJst("2026-11-14")!,
  });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: work.id,
    principalType: "user",
    principalId: principals.reviewer.userId,
    permission: "review",
  });
  await assignReviewers(ctx, principals.manager, {
    revisionId: revision.id,
    reviewerIds: [principals.reviewer.userId],
    reviewType: "general",
  });
  return { ctx, revision };
}

describe("日付だけの締切＝その日の終わり（利用者決定 2026-10-15）", () => {
  it("14 日締切: 13 日 23:59・14 日 23:59 はコメントでき、15 日 0:00 は拒否する", async () => {
    const { ctx, revision } = await setup();
    const post = () =>
      postComment(ctx, principals.reviewer, {
        revisionId: revision.id,
        body: "誤字",
        kind: "correction",
        severity: "minor",
      });
    ctx.clock.current = jst(2026, 11, 13, 23, 59);
    await expect(post()).resolves.toBeTruthy();
    ctx.clock.current = jst(2026, 11, 14, 23, 59);
    await expect(post()).resolves.toBeTruthy();
    ctx.clock.current = jst(2026, 11, 15);
    await expect(post()).rejects.toThrow(
      expect.objectContaining({ code: "revision_deadline_passed" }),
    );
  });

  it("受付終了のジョブは 14 日 23:59 では閉じず、15 日 0:00 で閉じる", async () => {
    const { ctx, revision } = await setup();
    ctx.clock.current = jst(2026, 11, 14, 23, 59);
    expect(await closeExpiredReviews(ctx)).toEqual([]);
    ctx.clock.current = jst(2026, 11, 15);
    expect((await closeExpiredReviews(ctx)).map((r) => r.id)).toEqual([revision.id]);
  });

  it("期限前の通知は当日 0:00 から届き、本文に「11/14（土）」を書く", async () => {
    const { ctx } = await setup();
    ctx.clock.current = jst(2026, 11, 13, 23, 59);
    expect(await remindUpcomingDeadlines(ctx)).toBe(0); // 締切の 24 時間と 1 分前
    ctx.clock.current = jst(2026, 11, 14);
    expect(await remindUpcomingDeadlines(ctx)).toBe(1);
    const [note] = await listMyNotifications(ctx, principals.reviewer);
    expect(note?.kind).toBe("deadline_approaching");
    expect(note?.body).toContain("11/14（土）");
  });
});
