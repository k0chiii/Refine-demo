import { isListedThread } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { finalizeWork } from "../usecases/approvals.ts";
import {
  assignThread,
  decideThread,
  deleteReply,
  deleteThread,
  editThread,
  listCarryCandidates,
  postComment,
  replyToThread,
} from "../usecases/comments.ts";
import { listMyNotifications, DELETED_COMMENT_NOTIFICATION } from "../usecases/notifications.ts";
import { assignReviewers } from "../usecases/reviews.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

async function setup() {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx);
  const revision = await submitRevision(ctx, work.id, { deadlineInHours: 24 });
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
  const post = (severity: "critical" | "info" = "critical") =>
    postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "団体名が誤り",
      kind: "correction",
      severity,
    });
  /** 返信の追記済みイベント ID（作成順） */
  const replyIds = async (threadId: string) =>
    (await ctx.threads.listEvents(threadId))
      .filter((e) => e.eventType === "replied")
      .map((e) => e.id!);
  return { ctx, work, revision, post, replyIds };
}

describe("コメントの削除（投稿者は校了前だけ・システム管理者は常に）", () => {
  it("投稿者は削除でき、一覧・校了のブロックから外れる。原文と削除の記録は履歴に残る", async () => {
    const { ctx, work, revision, post } = await setup();
    const thread = await post();
    // 重大未解決があるうちは校了できない
    await expect(
      finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: revision.id }),
    ).rejects.toThrow(code("approval_blocking_threads_remain"));

    await deleteThread(ctx, principals.reviewer, { threadId: thread.id });

    expect(await ctx.threads.listByRevision(revision.id)).toHaveLength(0);
    expect(await ctx.threads.listByRevision(revision.id, { includeDeleted: true })).toHaveLength(1);
    const stored = await ctx.threads.findById(thread.id);
    expect(stored?.deletedAt).toBe(ctx.clock.now());
    expect(stored?.body).toBe("団体名が誤り");
    expect(isListedThread(stored!)).toBe(false); // 返信が無ければ一覧にも出さない
    const events = await ctx.threads.listEvents(thread.id);
    expect(events.map((e) => e.eventType)).toEqual(["created", "deleted"]);
    await expect(
      finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: revision.id }),
    ).resolves.toBeTruthy();
  });

  it("投稿者以外（制作者・主管・校了権限者・ほかの委員）は削除できない", async () => {
    const { ctx, post } = await setup();
    const thread = await post();
    for (const p of [
      principals.creator,
      principals.manager,
      principals.approver,
      principals.stranger,
    ]) {
      await expect(deleteThread(ctx, p, { threadId: thread.id })).rejects.toThrow(
        code("comment_delete_not_author"),
      );
    }
    expect((await ctx.threads.findById(thread.id))?.deletedAt).toBeUndefined();
  });

  it("校了後は投稿者でも削除できない", async () => {
    const { ctx, work, revision, post } = await setup();
    const thread = await post("info");
    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: revision.id });
    await expect(deleteThread(ctx, principals.reviewer, { threadId: thread.id })).rejects.toThrow(
      code("work_already_finalized"),
    );
    expect((await ctx.threads.findById(thread.id))?.deletedAt).toBeUndefined();
  });

  it("削除済みのコメントには返信・訂正・採否・担当・再削除ができない。持ち越し候補にも出ない", async () => {
    const { ctx, revision, post } = await setup();
    const thread = await post();
    await deleteThread(ctx, principals.reviewer, { threadId: thread.id });
    const gone = code("comment_thread_deleted");
    await expect(
      replyToThread(ctx, principals.creator, { threadId: thread.id, body: "y" }),
    ).rejects.toThrow(gone);
    await expect(
      editThread(ctx, principals.reviewer, { threadId: thread.id, body: "z" }),
    ).rejects.toThrow(gone);
    await expect(
      decideThread(ctx, principals.creator, { threadId: thread.id, action: "accepted" }),
    ).rejects.toThrow(gone);
    await expect(
      assignThread(ctx, principals.creator, { threadId: thread.id, assigneeId: "u_x" }),
    ).rejects.toThrow(gone);
    await expect(deleteThread(ctx, principals.reviewer, { threadId: thread.id })).rejects.toThrow(
      gone,
    );
    expect(await listCarryCandidates(ctx, principals.creator, revision.id)).toEqual([]);
  });

  it("他の人の返信があれば一覧に残り（本文は伏せる対象）、その返信が全て削除されると一覧から外れる", async () => {
    const { ctx, revision, post, replyIds } = await setup();
    const thread = await post();
    await replyToThread(ctx, principals.creator, { threadId: thread.id, body: "対応します" });
    await replyToThread(ctx, principals.reviewer, { threadId: thread.id, body: "お願いします" });
    await deleteThread(ctx, principals.reviewer, { threadId: thread.id });

    // 件数・未解決の対象からは外れるが、返信の文脈のために一覧には残る
    expect(await ctx.threads.listByRevision(revision.id)).toHaveLength(0);
    const kept = await ctx.threads.findById(thread.id);
    expect(isListedThread(kept!)).toBe(true);

    const [creatorReply] = await replyIds(thread.id);
    await deleteReply(ctx, principals.creator, {
      threadId: thread.id,
      replyEventId: creatorReply!,
    });
    expect(isListedThread((await ctx.threads.findById(thread.id))!)).toBe(false);
  });

  it("自分の返信だけを削除でき、元の本文と削除の記録が履歴に残る", async () => {
    const { ctx, post, replyIds } = await setup();
    const thread = await post();
    await replyToThread(ctx, principals.creator, { threadId: thread.id, body: "対応します" });
    await replyToThread(ctx, principals.reviewer, { threadId: thread.id, body: "了解" });
    const [fromCreator, fromReviewer] = await replyIds(thread.id);

    // 他人の返信は（スレッドの投稿者・管理者でも）消せない
    await expect(
      deleteReply(ctx, principals.reviewer, { threadId: thread.id, replyEventId: fromCreator! }),
    ).rejects.toThrow(code("comment_delete_not_author"));
    await expect(
      deleteReply(ctx, principals.manager, { threadId: thread.id, replyEventId: fromReviewer! }),
    ).rejects.toThrow(code("comment_delete_not_author"));

    await deleteReply(ctx, principals.creator, { threadId: thread.id, replyEventId: fromCreator! });
    const events = await ctx.threads.listEvents(thread.id);
    expect(events.map((e) => e.eventType)).toEqual([
      "created",
      "replied",
      "replied",
      "reply_deleted",
    ]);
    expect(events.find((e) => e.id === fromCreator)?.payload).toMatchObject({ body: "対応します" });
    // スレッド自体は生きたまま
    expect((await ctx.threads.findById(thread.id))?.deletedAt).toBeUndefined();
    // 二重削除は見つからない扱い
    await expect(
      deleteReply(ctx, principals.creator, { threadId: thread.id, replyEventId: fromCreator! }),
    ).rejects.toThrow(code("comment_reply_not_found"));
  });

  it("校了後は返信も削除できない", async () => {
    const { ctx, work, revision, post, replyIds } = await setup();
    const thread = await post("info");
    await replyToThread(ctx, principals.creator, { threadId: thread.id, body: "対応します" });
    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: revision.id });
    const [id] = await replyIds(thread.id);
    await expect(
      deleteReply(ctx, principals.creator, { threadId: thread.id, replyEventId: id! }),
    ).rejects.toThrow(code("work_already_finalized"));
  });
});

describe("システム管理者の削除（利用者指示 2026-10-19）", () => {
  const auditOf = (ctx: Awaited<ReturnType<typeof setup>>["ctx"], entityType: string) =>
    ctx.state.audit.filter((a) => a.entityType === entityType);

  it("他人のコメントを削除でき、校了後でも削除できる。監査に誰が・何を・元の投稿者が残る", async () => {
    const { ctx, work, revision, post } = await setup();
    const open = await post();
    ctx.clock.advance(1000);
    await deleteThread(ctx, principals.sysadmin, { threadId: open.id });
    expect((await ctx.threads.findById(open.id))?.deletedAt).toBe(ctx.clock.now());
    expect(await ctx.threads.listByRevision(revision.id)).toHaveLength(0);

    const later = await post("info");
    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: revision.id });
    await deleteThread(ctx, principals.sysadmin, { threadId: later.id });
    expect((await ctx.threads.findById(later.id))?.deletedAt).toBeDefined();

    const entries = auditOf(ctx, "commentThread");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      entityId: open.id,
      operation: "delete",
      actorId: principals.sysadmin.userId,
      before: { authorId: principals.reviewer.userId },
      after: { byAdmin: true, workId: work.id, afterFinalized: false },
      at: expect.any(Number),
    });
    expect(entries[1]!.after).toMatchObject({ afterFinalized: true });
  });

  it("他人の返信を削除でき、校了後でも削除できる。監査に元の返信者が残る", async () => {
    const { ctx, work, revision, post, replyIds } = await setup();
    const thread = await post("info");
    await replyToThread(ctx, principals.creator, { threadId: thread.id, body: "対応します" });
    await replyToThread(ctx, principals.reviewer, { threadId: thread.id, body: "了解" });
    const [fromCreator, fromReviewer] = await replyIds(thread.id);
    await deleteReply(ctx, principals.sysadmin, {
      threadId: thread.id,
      replyEventId: fromCreator!,
    });
    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: revision.id });
    await deleteReply(ctx, principals.sysadmin, {
      threadId: thread.id,
      replyEventId: fromReviewer!,
    });
    const events = await ctx.threads.listEvents(thread.id);
    expect(events.filter((e) => e.eventType === "reply_deleted")).toHaveLength(2);
    const entries = auditOf(ctx, "commentReply");
    expect(entries.map((e) => e.entityId)).toEqual([fromCreator, fromReviewer]);
    expect(entries[0]).toMatchObject({
      actorId: principals.sysadmin.userId,
      before: { authorId: principals.creator.userId },
      after: { byAdmin: true, threadId: thread.id },
    });
  });

  it("管理者でない人は引き続き他人のものを削除できず、監査も残らない。本人の削除は監査に出さない", async () => {
    const { ctx, post } = await setup();
    const thread = await post();
    await expect(deleteThread(ctx, principals.manager, { threadId: thread.id })).rejects.toThrow(
      code("comment_delete_not_author"),
    );
    await deleteThread(ctx, principals.reviewer, { threadId: thread.id });
    expect(auditOf(ctx, "commentThread")).toHaveLength(0);
  });
});

describe("管理者の削除は返信ごとまとめて消す（利用者決定 2026-10-19）", () => {
  const auditOf = (ctx: Awaited<ReturnType<typeof setup>>["ctx"], entityType: string) =>
    ctx.state.audit.filter((a) => a.entityType === entityType);

  it("管理者が返信付きのコメントを削除すると、スレッドと全ての返信が消え、監査は 1 件、件数も更新される", async () => {
    const { ctx, work, revision, post, replyIds } = await setup();
    const kept = await post("info");
    const thread = await post("critical");
    await replyToThread(ctx, principals.creator, { threadId: thread.id, body: "対応します" });
    await replyToThread(ctx, principals.reviewer, { threadId: thread.id, body: "お願いします" });
    const ids = await replyIds(thread.id);
    expect(await ctx.threads.listByRevision(revision.id)).toHaveLength(2);

    ctx.clock.advance(1000);
    await deleteThread(ctx, principals.sysadmin, { threadId: thread.id });

    const stored = (await ctx.threads.findById(thread.id))!;
    expect(stored.deletedAt).toBe(ctx.clock.now());
    expect(isListedThread(stored)).toBe(false); // 「削除されたコメント」として残らない
    // 件数・未解決の対象からはスレッドだけが外れる
    expect((await ctx.threads.listByRevision(revision.id)).map((t) => t.id)).toEqual([kept.id]);
    // 返信は全て削除済み（原文は履歴に残る）
    const events = await ctx.threads.listEvents(thread.id);
    expect(
      events
        .filter((e) => e.eventType === "reply_deleted")
        .map((e) => (e.payload as { replyEventId: string }).replyEventId),
    ).toEqual(ids);
    expect(events.filter((e) => e.eventType === "replied")).toHaveLength(2);
    expect(events.filter((e) => e.eventType === "deleted")).toHaveLength(1);
    expect(events.find((e) => e.eventType === "deleted")?.payload).toMatchObject({
      cascade: true,
      repliesDeleted: 2,
    });
    // 返信を 1 件ずつ消す必要はなく、消そうとしても見つからない扱い
    await expect(
      deleteReply(ctx, principals.sysadmin, { threadId: thread.id, replyEventId: ids[0]! }),
    ).rejects.toThrow(code("comment_reply_not_found"));
    // 重大指摘が消えたので校了を止めない（残りは info のみ）
    await expect(
      finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: revision.id }),
    ).resolves.toBeTruthy();

    // 監査はまとめて 1 件（返信ごとには残さない）
    expect(auditOf(ctx, "commentReply")).toHaveLength(0);
    const entries = auditOf(ctx, "commentThread");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entityId: thread.id,
      operation: "delete",
      actorId: principals.sysadmin.userId,
      before: { authorId: principals.reviewer.userId },
      after: { byAdmin: true, repliesDeleted: 2, afterFinalized: false },
      at: ctx.clock.now(),
    });
  });

  it("校了後の管理者の削除も返信ごと消え、監査に校了後と返信の件数が残る。返信が無ければ 0 件", async () => {
    const { ctx, work, revision, post } = await setup();
    const withReply = await post("info");
    const plain = await post("info");
    await replyToThread(ctx, principals.creator, { threadId: withReply.id, body: "対応します" });
    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: revision.id });
    await deleteThread(ctx, principals.sysadmin, { threadId: withReply.id });
    await deleteThread(ctx, principals.sysadmin, { threadId: plain.id });
    expect(await ctx.threads.listByRevision(revision.id)).toHaveLength(0);
    expect(isListedThread((await ctx.threads.findById(withReply.id))!)).toBe(false);
    expect(auditOf(ctx, "commentThread").map((a) => a.after)).toMatchObject([
      { repliesDeleted: 1, afterFinalized: true },
      { repliesDeleted: 0, afterFinalized: true },
    ]);
  });

  it("投稿者本人の削除は従来どおり（他の人の返信があれば残り、監査は出ない）。管理者以外の他人は拒否", async () => {
    const { ctx, revision, post, replyIds } = await setup();
    const thread = await post();
    await replyToThread(ctx, principals.creator, { threadId: thread.id, body: "対応します" });
    for (const p of [principals.creator, principals.manager, principals.approver])
      await expect(deleteThread(ctx, p, { threadId: thread.id })).rejects.toThrow(
        code("comment_delete_not_author"),
      );
    await deleteThread(ctx, principals.reviewer, { threadId: thread.id });
    expect(isListedThread((await ctx.threads.findById(thread.id))!)).toBe(true);
    const events = await ctx.threads.listEvents(thread.id);
    expect(events.filter((e) => e.eventType === "reply_deleted")).toHaveLength(0);
    expect(events.find((e) => e.eventType === "deleted")?.payload).toEqual({ keepsReplies: true });
    expect(await ctx.threads.listByRevision(revision.id)).toHaveLength(0);
    expect(await replyIds(thread.id)).toHaveLength(1);
    expect(auditOf(ctx, "commentThread")).toHaveLength(0);
  });

  it("削除されたコメントへの通知は文面と抜粋を伏せ、飛び先（threadId）も返さない。残りの通知は変わらない", async () => {
    const { ctx, post } = await setup();
    const gone = await post("info");
    const stays = await post("info");
    const before = await listMyNotifications(ctx, principals.creator);
    expect(before.filter((n) => n.threadId === gone.id)).toHaveLength(1);
    await deleteThread(ctx, principals.sysadmin, { threadId: gone.id });
    const after = await listMyNotifications(ctx, principals.creator);
    expect(after).toHaveLength(before.length);
    const degraded = after.filter((n) => n.threadId === undefined && n.kind === "comment_posted");
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toMatchObject({ body: DELETED_COMMENT_NOTIFICATION.body });
    expect(degraded[0]!.preview).toBeUndefined();
    expect(after.find((n) => n.threadId === stays.id)?.body).not.toBe(
      DELETED_COMMENT_NOTIFICATION.body,
    );
  });
});
