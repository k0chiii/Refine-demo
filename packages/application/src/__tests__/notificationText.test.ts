import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { postComment } from "../usecases/comments.ts";
import { excerpt, jstMonthDay, listMyNotifications } from "../usecases/notifications.ts";
import { remindUpcomingDeadlines } from "../usecases/reviews.ts";
import { setWorkReviewers } from "../usecases/reviewers.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

describe("通知の文面（UI_M3E §35 W-14）", () => {
  it("抜粋は改行をつめ、切ったときだけ「…」を付ける", () => {
    expect(excerpt("一行目\n\n二行目")).toBe("一行目 二行目");
    expect(excerpt("あ".repeat(5), 5)).toBe("あああああ");
    expect(excerpt("あ".repeat(6), 5)).toBe("あああああ…");
  });

  it("締切は JST の月日と曜日", () => {
    // 2026-11-14 0:00 JST（土）
    expect(jstMonthDay(Date.UTC(2026, 10, 13, 15, 0))).toBe("11/14（土）");
  });

  it("本文は制作物・版・誰が・抜粋（題名の文言は確かめない）", async () => {
    const ctx = createInMemoryContext();
    ctx.state.names.set(principals.reviewer.userId, "査読 太郎");
    ctx.state.names.set(principals.manager.userId, "主管 花子");
    const work = await seedWork(ctx);
    const revision = await submitRevision(ctx, work.id, { deadlineInHours: 20 });
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    await setWorkReviewers(ctx, principals.manager, {
      workId: revision.workId,
      reviewerIds: [principals.reviewer.userId],
    });
    const assigned = (await listMyNotifications(ctx, principals.reviewer)).find(
      (n) => n.kind === "review_assigned",
    );
    expect(assigned?.title).toBeTruthy();
    for (const part of [
      "MF100 パンフレット",
      "第1版",
      "主管 花子",
      "11/2（月）05:00",
      "表紙の配色",
    ])
      expect(assigned?.body).toContain(part);

    await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: `表紙の${"誤字".repeat(100)}`,
      kind: "correction",
      severity: "major",
    });
    const posted = (await listMyNotifications(ctx, principals.creator)).find(
      (n) => n.kind === "comment_posted",
    );
    expect(posted?.title).toBeTruthy();
    for (const part of ["MF100 パンフレット", "第1版", "査読 太郎", "表紙の誤字"])
      expect(posted?.body).toContain(part);
    expect(posted?.body.endsWith("…")).toBe(true); // 長い本文は抜粋にして「…」で切る

    expect(await remindUpcomingDeadlines(ctx)).toBe(1);
    const reminder = (await listMyNotifications(ctx, principals.reviewer)).find(
      (n) => n.kind === "deadline_approaching",
    );
    expect(reminder?.title).toBeTruthy();
    expect(reminder?.body).toContain("11/2（月）05:00");
  });
});
