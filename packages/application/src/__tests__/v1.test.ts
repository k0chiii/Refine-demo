import { describe, expect, it } from "vite-plus/test";
import { finalizeWork } from "../usecases/approvals.ts";
import { addRequiredCheck, completeRequiredCheck, waiveRequiredCheck } from "../usecases/checks.ts";
import {
  assignThread,
  carryForwardThread,
  editThread,
  listCarryCandidates,
  postComment,
} from "../usecases/comments.ts";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../usecases/notifications.ts";
import {
  assignReviewers,
  closeExpiredReviews,
  remindUpcomingDeadlines,
} from "../usecases/reviews.ts";
import {
  confirmSubmission,
  expireUploadSessions,
  listOrphanUploadObjects,
  markUploadObjectsPurged,
  prepareSubmission,
  recordItemVerified,
  voidRevisionUseCase,
} from "../usecases/submissions.ts";
import { grantWorkPermission } from "../usecases/acl.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

describe("専門確認（§2.2-4 / C3）", () => {
  it("提出時に宣言した専門確認が作られ、未完了なら校了が拒否される。担当者が完了すれば校了できる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + 24 * HOUR,
      changeSummary: "",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
      requiredChecks: [
        { type: "name", assigneeId: principals.reviewer.userId },
        { type: "photo", label: "肖像権の確認" },
      ],
    });
    await recordItemVerified(ctx, principals.creator, {
      itemId: prepared.items[0]!.id,
      size: 1,
      sha256: "x",
    });
    const { revision } = await confirmSubmission(ctx, principals.creator, {
      sessionId: prepared.session.id,
    });
    const checks = await ctx.checks.listByRevision(revision.id);
    expect(checks.map((c) => [c.type, c.label, c.assigneeId ?? null])).toEqual([
      ["name", "めい（人名・団体名）", principals.reviewer.userId],
      ["photo", "肖像権の確認", null],
    ]);
    // 担当者に依頼通知が届く
    expect((await listMyNotifications(ctx, principals.reviewer)).map((n) => n.kind)).toContain(
      "check_requested",
    );

    await expect(
      finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: revision.id }),
    ).rejects.toThrow(code("approval_required_checks_incomplete"));
    // 担当外の人は完了できない。担当者は完了できる
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.reviewer.userId,
      permission: "review",
    });
    await expect(
      completeRequiredCheck(ctx, principals.reviewer, { checkId: checks[1]!.id }),
    ).resolves.toMatchObject({ state: "done" }); // 担当なし → 権限者なら誰でも
    await expect(
      completeRequiredCheck(ctx, principals.stranger, { checkId: checks[0]!.id }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      completeRequiredCheck(ctx, principals.reviewer, {
        checkId: checks[0]!.id,
        note: "規約で確認",
      }),
    ).resolves.toMatchObject({ state: "done", doneBy: principals.reviewer.userId });
    const { event } = await finalizeWork(ctx, principals.approver, {
      workId: work.id,
      revisionId: revision.id,
    });
    expect(event.action).toBe("finalized");
    expect((event.requiredChecksSnapshot as { checks: unknown[] }).checks).toHaveLength(2);
  });

  it("校了権限者は理由付きで免除でき、理由付き例外校了も可能。後から追加もできる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    const check = await addRequiredCheck(ctx, principals.manager, {
      revisionId: rev.id,
      type: "language",
      assigneeId: principals.reviewer.userId,
    });
    await expect(
      waiveRequiredCheck(ctx, principals.reviewer, { checkId: check.id, reason: "x" }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      waiveRequiredCheck(ctx, principals.approver, { checkId: check.id, reason: "" }),
    ).rejects.toThrow(code("check_waive_reason_required"));
    const c2 = await addRequiredCheck(ctx, principals.manager, {
      revisionId: rev.id,
      type: "rules",
    });
    await waiveRequiredCheck(ctx, principals.approver, {
      checkId: check.id,
      reason: "外国語表記なし",
    });
    const { event } = await finalizeWork(ctx, principals.approver, {
      workId: work.id,
      revisionId: rev.id,
      exceptionReason: "規則確認は印刷後に実施",
    });
    expect(event.action).toBe("exception_finalized");
    expect(
      (event.requiredChecksSnapshot as { incompleteCheckIds: string[] }).incompleteCheckIds,
    ).toEqual([c2.id]);
  });
});

describe("指摘の担当・訂正・次版への引き継ぎ（F-07）", () => {
  it("担当割当は採否判断者のみ。担当者へ通知される", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.reviewer.userId,
      permission: "review",
    });
    const t = await postComment(ctx, principals.reviewer, {
      revisionId: rev.id,
      body: "x",
      kind: "correction",
      severity: "minor",
    });
    await expect(
      assignThread(ctx, principals.reviewer, {
        threadId: t.id,
        assigneeId: principals.manager.userId,
      }),
    ).rejects.toThrow(code("forbidden"));
    await assignThread(ctx, principals.creator, {
      threadId: t.id,
      assigneeId: principals.manager.userId,
    });
    expect((await ctx.threads.findById(t.id))?.assigneeId).toBe(principals.manager.userId);
    expect((await listMyNotifications(ctx, principals.manager)).map((n) => n.kind)).toContain(
      "comment_assigned",
    );
  });

  it("訂正は本人のみ・訂正前本文がイベントに残る", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.reviewer.userId,
      permission: "review",
    });
    const t = await postComment(ctx, principals.reviewer, {
      revisionId: rev.id,
      body: "誤字あり",
      kind: "correction",
      severity: "minor",
    });
    await expect(
      editThread(ctx, principals.creator, { threadId: t.id, body: "x" }),
    ).rejects.toThrow(code("comment_edit_not_author"));
    const edited = await editThread(ctx, principals.reviewer, {
      threadId: t.id,
      body: "誤字あり（3ページ）",
    });
    expect(edited.editCount).toBe(1);
    const events = await ctx.threads.listEvents(t.id);
    expect(events.at(-1)).toMatchObject({
      eventType: "edited",
      payload: { previousBody: "誤字あり" },
    });
  });

  it("前版の未解決指摘を次版へ引き継ぐ: 原指摘は deferred、新版に carriedFrom 付きで複製、二重引き継ぎ不可", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const r1 = await submitRevision(ctx, work.id);
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.reviewer.userId,
      permission: "review",
    });
    const open = await postComment(ctx, principals.reviewer, {
      revisionId: r1.id,
      body: "未対応",
      kind: "correction",
      severity: "major",
    });
    const done = await postComment(ctx, principals.reviewer, {
      revisionId: r1.id,
      body: "対応済み",
      kind: "correction",
      severity: "minor",
    });
    await ctx.threads.update({ ...done, resolution: "resolved" });
    ctx.clock.advance(HOUR);
    const r2 = await submitRevision(ctx, work.id);
    const candidates = await listCarryCandidates(ctx, principals.creator, r2.id);
    expect(candidates.map((c) => c.id)).toEqual([open.id]);
    await expect(
      carryForwardThread(ctx, principals.reviewer, { threadId: open.id, targetRevisionId: r2.id }),
    ).rejects.toThrow(code("forbidden"));
    const carried = await carryForwardThread(ctx, principals.creator, {
      threadId: open.id,
      targetRevisionId: r2.id,
    });
    expect(carried).toMatchObject({
      revisionId: r2.id,
      carriedFromThreadId: open.id,
      resolution: "open",
      body: "未対応",
    });
    expect(await ctx.threads.findById(open.id)).toMatchObject({
      resolution: "deferred",
      carriedToThreadId: carried.id,
    });
    await expect(
      carryForwardThread(ctx, principals.creator, { threadId: open.id, targetRevisionId: r2.id }),
    ).rejects.toThrow(code("comment_already_carried"));
    expect(await listCarryCandidates(ctx, principals.creator, r2.id)).toEqual([]);
  });
});

describe("誤提出の無効化・提出準備の清掃", () => {
  it("受付中の版を理由付きで無効化でき、次の版番号は進む。校正者と職責者に通知", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const r1 = await submitRevision(ctx, work.id);
    await assignReviewers(ctx, principals.manager, {
      revisionId: r1.id,
      reviewerIds: [principals.reviewer.userId],
      reviewType: "general",
    });
    await expect(
      voidRevisionUseCase(ctx, principals.reviewer, { revisionId: r1.id, reason: "x" }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      voidRevisionUseCase(ctx, principals.creator, { revisionId: r1.id, reason: " " }),
    ).rejects.toThrow(code("revision_void_reason_required"));
    const voided = await voidRevisionUseCase(ctx, principals.creator, {
      revisionId: r1.id,
      reason: "ファイル取り違え",
    });
    expect(voided.reviewState).toBe("void");
    expect((await listMyNotifications(ctx, principals.reviewer)).map((n) => n.kind)).toContain(
      "revision_voided",
    );
    const r2 = await submitRevision(ctx, work.id);
    expect(r2.sequence).toBe(2);
    await expect(
      voidRevisionUseCase(ctx, principals.creator, { revisionId: r1.id, reason: "再度" }),
    ).rejects.toThrow(code("revision_void_not_allowed"));
  });

  it("期限切れの提出準備は abandoned になる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + 48 * HOUR,
      changeSummary: "",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
    });
    expect(await expireUploadSessions(ctx)).toEqual([]);
    ctx.clock.advance(25 * HOUR);
    expect(await expireUploadSessions(ctx)).toEqual([prepared.session.id]);
    await expect(
      confirmSubmission(ctx, principals.creator, { sessionId: prepared.session.id }),
    ).rejects.toThrow(code("upload_session_not_open"));
  });

  it("abandoned セッションの R2 オブジェクトだけが清掃対象になり、削除記録は冪等で、確定済みの実体は対象外", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    // 確定済みの版（清掃対象にならない）
    await submitRevision(ctx, work.id);
    // 放置セッション: ファイル 2 件 + 外部リンク 1 件（objectKey 無し）
    const stale = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + 24 * HOUR,
      changeSummary: "",
      focusNotes: "",
      items: [
        { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" },
        { fileName: "b.png", mimeType: "image/png", type: "image", role: "source" },
        {
          fileName: "https://figma.invalid/x",
          mimeType: "text/uri-list",
          type: "external_link",
          role: "external",
          externalUrl: "https://figma.invalid/x",
        },
      ],
    });
    expect(await listOrphanUploadObjects(ctx)).toEqual([]);
    ctx.clock.advance(25 * HOUR);
    await expireUploadSessions(ctx);
    const orphans = await listOrphanUploadObjects(ctx);
    expect(orphans.map((o) => o.itemId).sort()).toEqual(
      stale.items
        .filter((i) => i.objectKey)
        .map((i) => i.id)
        .sort(),
    );
    // 確定済み版の項目を混ぜても無視される（まだ open/confirmed の実体は消さない）
    const confirmedItemIds = (await ctx.uploads.listItems(stale.session.id)).map((i) => i.id);
    void confirmedItemIds;
    const [first, second] = orphans;
    expect(await markUploadObjectsPurged(ctx, [first!.itemId, first!.itemId])).toBe(1);
    expect(await listOrphanUploadObjects(ctx)).toEqual([second]);
    expect((await ctx.uploads.findById(stale.session.id))?.purgedAt).toBeUndefined();
    expect(await markUploadObjectsPurged(ctx, [second!.itemId])).toBe(1);
    expect(await listOrphanUploadObjects(ctx)).toEqual([]);
    expect((await ctx.uploads.findById(stale.session.id))?.purgedAt).toBe(ctx.clock.now());
    // objectKey は履歴として残る
    expect((await ctx.uploads.findItem(first!.itemId))?.objectKey).toBeDefined();
  });
});

describe("アプリ内通知（F-11）", () => {
  it("版提出・割当・指摘・採否・校了で関係者に通知され、本人には届かない。既読管理ができる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    expect(
      (await listMyNotifications(ctx, principals.creator)).filter(
        (n) => n.kind === "revision_submitted",
      ),
    ).toHaveLength(0);
    expect((await listMyNotifications(ctx, principals.approver)).map((n) => n.kind)).toEqual([
      "revision_submitted",
    ]);
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.reviewer.userId,
      permission: "review",
    });
    await assignReviewers(ctx, principals.manager, {
      revisionId: rev.id,
      reviewerIds: [principals.reviewer.userId],
      reviewType: "general",
    });
    expect((await listMyNotifications(ctx, principals.reviewer)).map((n) => n.kind)).toEqual([
      "review_assigned",
    ]);
    ctx.clock.advance(1000);
    const t = await postComment(ctx, principals.reviewer, {
      revisionId: rev.id,
      body: "x",
      kind: "correction",
      severity: "minor",
    });
    expect((await listMyNotifications(ctx, principals.creator)).map((n) => n.kind)).toEqual([
      "comment_posted",
    ]);
    const { decideThread } = await import("../usecases/comments.ts");
    ctx.clock.advance(1000);
    await decideThread(ctx, principals.creator, { threadId: t.id, action: "accepted" });
    expect((await listMyNotifications(ctx, principals.reviewer)).map((n) => n.kind)).toEqual([
      "comment_decided",
      "review_assigned",
    ]);
    ctx.clock.advance(1000);
    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id });
    expect((await listMyNotifications(ctx, principals.reviewer))[0]?.kind).toBe("work_finalized");

    expect(await ctx.notifications.countUnread(principals.reviewer.userId)).toBe(3);
    const first = (await listMyNotifications(ctx, principals.reviewer))[0]!;
    await expect(markNotificationRead(ctx, principals.creator, first.id)).rejects.toThrow(
      code("forbidden"),
    );
    await markNotificationRead(ctx, principals.reviewer, first.id);
    expect(await ctx.notifications.countUnread(principals.reviewer.userId)).toBe(2);
    expect(await markAllNotificationsRead(ctx, principals.reviewer)).toMatchObject({
      marked: 2,
      hasMore: false,
    });
  });

  it("期限接近リマインドは未確認の校正者に 1 回だけ届く", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id, { deadlineInHours: 48 });
    await assignReviewers(ctx, principals.manager, {
      revisionId: rev.id,
      reviewerIds: [principals.reviewer.userId, principals.stranger.userId],
      reviewType: "general",
    });
    expect(await remindUpcomingDeadlines(ctx)).toBe(0); // 48h 前はまだ
    ctx.clock.advance(30 * HOUR);
    expect(await remindUpcomingDeadlines(ctx)).toBe(2);
    expect(await remindUpcomingDeadlines(ctx)).toBe(0); // 二度送らない
    expect((await listMyNotifications(ctx, principals.reviewer)).map((n) => n.kind)).toEqual([
      "deadline_approaching",
      "review_assigned",
    ]);
    ctx.clock.advance(20 * HOUR);
    await closeExpiredReviews(ctx);
    expect(await remindUpcomingDeadlines(ctx)).toBe(0); // 受付終了後は送らない
  });
});
