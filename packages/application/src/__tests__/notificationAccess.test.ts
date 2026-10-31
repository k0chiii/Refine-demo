import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission, revokeWorkPermission } from "../usecases/acl.ts";
import {
  listMyNotifications,
  markAllNotificationsRead,
  notify,
  REDACTED_NOTIFICATION,
} from "../usecases/notifications.ts";
import { remindUpcomingDeadlines } from "../usecases/reviews.ts";
import { setWorkReviewers } from "../usecases/reviewers.ts";
import { saveTeam } from "../usecases/teams.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

/** 通知本文にも制作物の ACL を適用する（§5.2-10。レビュー指摘 P1） */
describe("通知の本文と制作物の閲覧権限", () => {
  it("非公開の制作物に閲覧 ACL の無い人を割り当てても、作品名・確認観点を含む通知を送らない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { title: "極秘ポスター", confidentiality: "restricted" });
    const revision = await submitRevision(ctx, work.id);
    await setWorkReviewers(ctx, principals.manager, {
      workId: revision.workId,
      reviewerIds: [principals.stranger.userId],
    });
    const [note] = await listMyNotifications(ctx, principals.stranger);
    expect(note?.kind).toBe("review_assigned");
    expect(note?.title).toBe(REDACTED_NOTIFICATION.title);
    expect(note?.body).toBe(REDACTED_NOTIFICATION.body);
    // 保存された本文にも保護情報を残さない（読取側の判定に頼り切らない）
    const stored = ctx.state.notifications
      .all()
      .find((n) => n.recipientId === principals.stranger.userId)!;
    expect(stored.body).not.toContain("極秘ポスター");
    expect(stored.body).not.toContain("表紙の配色");
    expect(note).not.toHaveProperty("workId");
    expect(note).not.toHaveProperty("revisionId");
  });

  it("ACL を取り消した後は、既存の通知も作品名を伏せて返す（再付与で戻る）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { title: "極秘ポスター", confidentiality: "restricted" });
    const revision = await submitRevision(ctx, work.id);
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    await setWorkReviewers(ctx, principals.manager, {
      workId: revision.workId,
      reviewerIds: [principals.reviewer.userId],
    });
    const [before] = await listMyNotifications(ctx, principals.reviewer);
    expect(before?.body).toContain("極秘ポスター");
    expect(before?.workId).toBe(work.id);

    await revokeWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userId: principals.reviewer.userId,
    });
    const [after] = await listMyNotifications(ctx, principals.reviewer);
    expect(after).toMatchObject({ id: before!.id, kind: "review_assigned" });
    expect(after?.title).toBe(REDACTED_NOTIFICATION.title);
    expect(after?.body).toBe(REDACTED_NOTIFICATION.body);
    expect(after).not.toHaveProperty("workId");
    expect(after).not.toHaveProperty("revisionId");

    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    const [again] = await listMyNotifications(ctx, principals.reviewer);
    expect(again?.body).toContain("極秘ポスター");
  });

  it("通常の制作物は委員なら誰でも見られるので、割当の通知も伏せない（利用者決定 2026-10-17）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { title: "公開チラシ" });
    const revision = await submitRevision(ctx, work.id);
    await setWorkReviewers(ctx, principals.manager, {
      workId: revision.workId,
      reviewerIds: [principals.stranger.userId],
    });
    const [note] = await listMyNotifications(ctx, principals.stranger);
    expect(note?.body).toContain("公開チラシ");
    expect(note?.workId).toBe(work.id);
  });

  it("非公開の制作物でも、担当の所属する人には伏せない（所属は担当の一覧から判定する）", async () => {
    const ctx = createInMemoryContext();
    const bureau = await saveTeam(ctx, principals.sysadmin, { name: "広報局", kind: "bureau" });
    const design = await saveTeam(ctx, principals.sysadmin, {
      name: "デザイン担当",
      kind: "team",
      parentId: bureau.id,
      memberIds: [principals.stranger.userId],
    });
    const work = await seedWork(ctx, {
      title: "極秘ポスター",
      confidentiality: "restricted",
      productionTeamIds: [design.id],
    });
    const revision = await submitRevision(ctx, work.id);
    await setWorkReviewers(ctx, principals.manager, {
      workId: revision.workId,
      reviewerIds: [principals.stranger.userId],
    });
    const stored = ctx.state.notifications
      .all()
      .find((n) => n.recipientId === principals.stranger.userId)!;
    expect(stored.body).toContain("極秘ポスター");
    const [note] = await listMyNotifications(ctx, {
      ...principals.stranger,
      teamIds: [design.id],
    });
    expect(note?.body).toContain("極秘ポスター");
  });

  it("旧フィードバックの通知も制作物の閲覧権限で守る（コメントへ統合したため）。restricted の制作物は伏せる", async () => {
    const ctx = createInMemoryContext();
    const open = await seedWork(ctx, { title: "公開チラシ" });
    const secret = await seedWork(ctx, { title: "極秘ポスター", confidentiality: "restricted" });
    for (const w of [open, secret])
      await notify(ctx, [principals.stranger.userId], principals.creator.userId, {
        kind: "feedback_posted",
        title: "新しい投稿",
        body: `「${w.title}」のスレッド`,
        workId: w.id,
        threadId: `t_${w.id}`,
      });
    const list = await listMyNotifications(ctx, principals.stranger);
    const bodies = list.map((n) => n.body);
    expect(bodies).toContain("「公開チラシ」のスレッド");
    expect(bodies).toContain(REDACTED_NOTIFICATION.body);
    expect(bodies.join()).not.toContain("極秘ポスター");
  });
});

/** 「すべて既読」が最新 200 件より古い未読に届く（レビュー指摘 P2） */
describe("すべて既読", () => {
  it("未読 201 件: 1 回目 200 件・続きがある、2 回目 1 件・続きなし、未読は 0", async () => {
    const ctx = createInMemoryContext();
    for (let i = 0; i < 201; i++) {
      ctx.clock.current += 1000;
      await notify(ctx, [principals.reviewer.userId], null, {
        kind: "rule_proposed",
        title: "表記ルールの提案",
        body: `提案 ${i}`,
      });
    }
    expect(await markAllNotificationsRead(ctx, principals.reviewer)).toMatchObject({
      marked: 200,
      hasMore: true,
    });
    expect(await markAllNotificationsRead(ctx, principals.reviewer)).toMatchObject({
      marked: 1,
      hasMore: false,
    });
    expect(await ctx.notifications.countUnread(principals.reviewer.userId)).toBe(0);
  });

  it("押した後に届いた通知は既読にしない（続きの処理は押した時刻で区切る）", async () => {
    const ctx = createInMemoryContext();
    await notify(ctx, [principals.reviewer.userId], null, {
      kind: "rule_proposed",
      title: "表記ルールの提案",
      body: "古い",
    });
    const first = await markAllNotificationsRead(ctx, principals.reviewer, 1);
    ctx.clock.current += 1000;
    await notify(ctx, [principals.reviewer.userId], null, {
      kind: "rule_proposed",
      title: "表記ルールの提案",
      body: "新しい",
    });
    expect(first.marked).toBe(1);
    expect(await ctx.notifications.countUnread(principals.reviewer.userId)).toBe(1);
  });
});

/** リマインドが古い未確認の割当に埋もれない（レビュー指摘 P2） */
describe("期限接近リマインドの対象", () => {
  it("受付終了・期限切れの古い未確認割当が 500 件あっても、現行の割当に届く", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const old = await submitRevision(ctx, work.id, { deadlineInHours: 1 });
    for (let i = 0; i < 500; i++)
      await ctx.assignments.upsert({
        revisionId: old.id,
        reviewerId: `u_old_${i}`,
        reviewType: "general",
        state: "pending",
      });
    ctx.clock.current += 2 * HOUR; // 古い版は期限切れ（受付中のまま残っていても対象外）
    const current = await submitRevision(ctx, work.id, { deadlineInHours: 12 });
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    await setWorkReviewers(ctx, principals.manager, {
      workId: current.workId,
      reviewerIds: [principals.reviewer.userId],
    });
    expect(await remindUpcomingDeadlines(ctx)).toBe(1);
    expect(await remindUpcomingDeadlines(ctx)).toBe(0);
    const notes = await listMyNotifications(ctx, principals.reviewer);
    expect(notes.filter((n) => n.kind === "deadline_approaching")).toHaveLength(1);
  });
});
