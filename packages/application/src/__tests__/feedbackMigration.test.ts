import { projectThreadEvents, replyEntries, type FeedbackFile } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { finalizeWork } from "../usecases/approvals.ts";
import { authorizeCommentFile, listCommentFileViews } from "../usecases/commentFiles.ts";
import { decideThread, deleteThread } from "../usecases/comments.ts";
import {
  isFeedbackThreadSettled,
  migrateFeedbackThread,
  previewFeedbackThreadMigration,
  resolveMigratedFeedbackThread,
} from "../usecases/feedbackMigration.ts";
import { listMyNotifications, notify } from "../usecases/notifications.ts";
import { createInMemoryContext, type InMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const { creator, reviewer, stranger, approver } = principals;

async function setup() {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx, { title: "EVE 企画ポスター" });
  const rev1 = await submitRevision(ctx, work.id);
  ctx.clock.advance(HOUR);
  const rev2 = await submitRevision(ctx, work.id);
  return { ctx, work, rev1, rev2 };
}

/** FB の行を直接作る（FB の機能は廃止したので、旧データの再現） */
function addThread(
  ctx: InMemoryContext,
  workId: string,
  over: Partial<Parameters<InMemoryContext["state"]["feedbackThreads"]["insert"]>[0]> = {},
) {
  return ctx.state.feedbackThreads.insert({
    workId,
    title: "配色の方向性",
    createdBy: creator.userId,
    createdAt: 1_000,
    lastPostAt: 3_000,
    postCount: 2,
    participantIds: [creator.userId, reviewer.userId],
    ...over,
  });
}
function addPost(
  ctx: InMemoryContext,
  thread: { id: string; workId: string },
  over: Partial<Parameters<InMemoryContext["state"]["feedbackPosts"]["insert"]>[0]> = {},
) {
  return ctx.state.feedbackPosts.insert({
    threadId: thread.id,
    workId: thread.workId,
    authorId: creator.userId,
    body: "配色の意図です",
    mentions: [],
    fileIds: [],
    reactions: [],
    createdAt: 1_000,
    ...over,
  });
}
function addFile(ctx: InMemoryContext, workId: string, over: Partial<FeedbackFile> = {}) {
  const { id: _id, ...rest } = over;
  void _id;
  return ctx.state.feedbackFiles.insert({
    workId,
    uploaderId: creator.userId,
    fileName: "案A.pdf",
    mimeType: "application/pdf",
    type: "pdf",
    declaredSize: 10,
    size: 10,
    sha256: "abc",
    keyPrefix: "feedback/w/f/案A.pdf",
    objectKey: "feedback/w/f/案A.pdf/attempts/a1",
    status: "verified",
    createdAt: 500,
    ...rest,
  });
}

describe("FB のスレッドをコメントへ移す", () => {
  it("最初の投稿がコメント、残りが返信になり、リアクション・メンション・時刻・既読・やり取りが移る", async () => {
    const { ctx, work, rev2 } = await setup();
    const t = addThread(ctx, work.id);
    addPost(ctx, t, {
      body: "* 配色の意図です",
      mentions: [reviewer.userId],
      reactions: [{ emoji: "👍", userIds: [reviewer.userId] }],
      createdAt: 1_000,
    });
    addPost(ctx, t, {
      authorId: reviewer.userId,
      body: "了解です @creator",
      mentions: [creator.userId],
      reactions: [{ emoji: "🎉", userIds: [creator.userId] }],
      createdAt: 2_000,
      editedAt: 2_500,
    });
    addPost(ctx, t, {
      authorId: stranger.userId,
      body: "消した投稿",
      createdAt: 2_800,
      deletedAt: 9,
    });
    addPost(ctx, t, { authorId: creator.userId, body: "続き", createdAt: 3_000 });
    ctx.state.feedbackReads.set(`${reviewer.userId}|${t.id}`, 3_100);
    ctx.state.feedbackReads.set(`${stranger.userId}|${t.id}`, 1_500);

    const result = await migrateFeedbackThread(ctx, t);
    expect(result).toMatchObject({
      status: "migrated",
      workId: work.id,
      resolution: "open",
      replies: 2,
      files: 0,
      reads: 2,
    });
    const [thread] = ctx.state.threads.all();
    expect(thread).toMatchObject({
      revisionId: rev2.id,
      authorId: creator.userId,
      // 題名が本文から作られるものと違うので、頭に足す
      body: "【配色の方向性】\n* 配色の意図です",
      kind: "correction",
      severity: "major",
      resolution: "open",
      createdAt: 1_000,
      mentions: [reviewer.userId],
      reactions: [{ emoji: "👍", userIds: [reviewer.userId] }],
      migratedFromFeedbackThreadId: t.id,
      lastActivityAt: 3_000,
      lastActivityBy: creator.userId,
      replyCount: 2,
      participantIds: [creator.userId, reviewer.userId],
    });
    expect(thread).not.toHaveProperty("bodyFormat");

    const events = await ctx.threads.listEvents(thread!.id);
    expect(events.map((e) => e.eventType)).toEqual(["created", "replied", "replied"]);
    expect(replyEntries(events).map((r) => r.actorId)).toEqual([reviewer.userId, creator.userId]);
    expect(
      events
        .filter((e) => e.eventType === "replied")
        .map((e) => (e.payload as { body: string }).body),
    ).toEqual(["了解です @creator", "続き"]);
    const [first] = events.filter((e) => e.eventType === "replied");
    expect(first).toMatchObject({
      createdAt: 2_000,
      payload: { body: "了解です @creator", mentions: [creator.userId] },
      reactions: [{ emoji: "🎉", userIds: [creator.userId] }],
    });
    expect(first!.payload).not.toHaveProperty("bodyFormat");

    expect(await ctx.threads.readAt(reviewer.userId, thread!.id)).toBe(3_100);
    expect(await ctx.threads.readAt(stranger.userId, thread!.id)).toBe(1_500);
    expect(await ctx.threads.readAt(creator.userId, thread!.id)).toBeNull();
  });

  it("未解決で移すのは校了前の制作物の最新の受付中の版だけ。それ以外は解決済みにして、履歴に残す", async () => {
    const { ctx, work, rev1, rev2 } = await setup();
    const latest = addThread(ctx, work.id, { revisionId: rev2.id });
    const older = addThread(ctx, work.id, { revisionId: rev1.id });
    for (const t of [latest, older]) addPost(ctx, t);

    await migrateFeedbackThread(ctx, latest);
    await migrateFeedbackThread(ctx, older);
    const byFrom = (id: string) =>
      ctx.state.threads.all().find((x) => x.migratedFromFeedbackThreadId === id)!;
    expect(byFrom(latest.id).resolution).toBe("open");
    expect(byFrom(older.id)).toMatchObject({ revisionId: rev1.id, resolution: "resolved" });
    const decided = (await ctx.threads.listEvents(byFrom(older.id).id)).filter(
      (e) => e.eventType === "decided",
    );
    expect(decided).toHaveLength(1);
    expect(decided[0]).toMatchObject({
      actorId: "system",
      payload: { from: "open", to: "resolved" },
    });
    expect(decided[0]!.reason).toBeTruthy();
    expect((await ctx.threads.listEvents(byFrom(latest.id).id)).map((e) => e.eventType)).toEqual([
      "created",
    ]);
  });

  it("校了した制作物へ立てた FB は、最新の版でも解決済みで移る", async () => {
    const { ctx, work, rev2 } = await setup();
    ctx.clock.advance(48 * HOUR);
    await finalizeWork(ctx, approver, { workId: work.id, revisionId: rev2.id });
    const t = addThread(ctx, work.id);
    addPost(ctx, t);
    const r = await migrateFeedbackThread(ctx, t);
    expect(r).toMatchObject({ status: "migrated", resolution: "resolved" });
  });

  it("版が無い制作物の FB は移さない。スレッドの版が無ければ最新の版へ、場所は持ち越さない", async () => {
    const { ctx, work, rev2 } = await setup();
    const empty = await seedWork(ctx, { title: "まだ版の無い制作物" });
    const t0 = addThread(ctx, empty.id);
    addPost(ctx, t0);
    expect(await migrateFeedbackThread(ctx, t0)).toEqual({
      status: "skipped",
      reason: "no_revision",
    });
    // 移せなかった生きたスレッドが残っているあいだは、FB を消さない
    expect(await isFeedbackThreadSettled(ctx, t0)).toBe(false);

    const t1 = addThread(ctx, work.id, {
      revisionId: "no-such-revision",
      anchor: { type: "image_pin", artifactId: "x", point: { x: 0.1, y: 0.2 } },
    });
    addPost(ctx, t1);
    await migrateFeedbackThread(ctx, t1);
    const moved = ctx.state.threads.all().find((x) => x.migratedFromFeedbackThreadId === t1.id)!;
    expect(moved.revisionId).toBe(rev2.id);
    expect(moved.anchor).toBeUndefined();
  });

  it("場所（anchor）を持つ FB は、同じ場所のコメントになる", async () => {
    const { ctx, work, rev2 } = await setup();
    const art = ctx.state.artifacts.all().find((a) => a.revisionId === rev2.id)!;
    const anchor = {
      type: "pdf_rect" as const,
      artifactId: art.id,
      page: 1,
      rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    };
    const t = addThread(ctx, work.id, { revisionId: rev2.id, anchor });
    addPost(ctx, t);
    await migrateFeedbackThread(ctx, t);
    expect(ctx.state.threads.all()[0]).toMatchObject({ anchor, artifactId: art.id });
  });

  it("削除済みのスレッド・生きた投稿の無いスレッドは対象外", async () => {
    const { ctx, work } = await setup();
    const deleted = addThread(ctx, work.id, { deletedAt: 9 });
    addPost(ctx, deleted);
    const noPosts = addThread(ctx, work.id, { postCount: 0 });
    const allGone = addThread(ctx, work.id);
    addPost(ctx, allGone, { deletedAt: 9 });
    expect(await migrateFeedbackThread(ctx, deleted)).toEqual({
      status: "skipped",
      reason: "not_live",
    });
    expect(await migrateFeedbackThread(ctx, noPosts)).toEqual({
      status: "skipped",
      reason: "not_live",
    });
    expect(await migrateFeedbackThread(ctx, allGone)).toEqual({
      status: "skipped",
      reason: "no_posts",
    });
    expect(ctx.state.threads.all()).toHaveLength(0);
  });

  it("添付は同じ R2 の実体を指すコメントの添付になり、コメントの添付と同じ認可で読める。サムネイルは無い", async () => {
    const { ctx, work } = await setup();
    const t = addThread(ctx, work.id);
    const f1 = addFile(ctx, work.id);
    const f2 = addFile(ctx, work.id, {
      fileName: "参考.png",
      mimeType: "image/png",
      type: "image",
      objectKey: "feedback/w/g/参考.png/attempts/a2",
    });
    const failed = addFile(ctx, work.id, { status: "failed", objectKey: "" });
    addPost(ctx, t, { fileIds: [f1.id] });
    addPost(ctx, t, {
      authorId: reviewer.userId,
      createdAt: 2_000,
      fileIds: [f2.id, failed.id, "missing"],
    });
    expect(await previewFeedbackThreadMigration(ctx, t)).toMatchObject({
      files: 2,
      filesSkipped: 2,
    });

    await migrateFeedbackThread(ctx, t);
    const [thread] = ctx.state.threads.all();
    const files = ctx.state.commentFiles.all();
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.objectKey).sort()).toEqual([f1.objectKey, f2.objectKey].sort());
    expect(thread!.fileIds).toHaveLength(1);
    const own = files.find((f) => f.objectKey === f1.objectKey)!;
    expect(own).toMatchObject({
      status: "verified",
      threadId: thread!.id,
      revisionId: thread!.revisionId,
      uploaderId: creator.userId,
      fileName: "案A.pdf",
      size: 10,
      sha256: "abc",
    });
    expect(own.eventId).toBeUndefined();
    expect(own.thumbObjectKey).toBeUndefined();

    const reply = (await ctx.threads.listEvents(thread!.id)).find(
      (e) => e.eventType === "replied",
    )!;
    const onReply = files.find((f) => f.objectKey === f2.objectKey)!;
    expect(onReply.eventId).toBe(reply.id);
    expect(reply.payload).toMatchObject({ fileIds: [onReply.id] });
    expect(await listCommentFileViews(ctx, [onReply.id])).toEqual([
      expect.objectContaining({ id: onReply.id, name: "参考.png", type: "image", hasThumb: false }),
    ]);

    // コメントの添付と同じ認可で、FB のキーのまま読める
    const access = await authorizeCommentFile(ctx, stranger, {
      fileId: own.id,
      variant: "original",
    });
    expect(access).toMatchObject({ objectKey: f1.objectKey, fileName: "案A.pdf" });
    await expect(
      authorizeCommentFile(ctx, stranger, { fileId: own.id, variant: "thumb" }),
    ).rejects.toThrow();
  });

  it("二度流しても増えない（移行済みは飛ばす）", async () => {
    const { ctx, work } = await setup();
    const t = addThread(ctx, work.id);
    addPost(ctx, t);
    addPost(ctx, t, { createdAt: 2_000 });
    const first = await migrateFeedbackThread(ctx, t);
    const again = await migrateFeedbackThread(ctx, t);
    expect(first.status).toBe("migrated");
    expect(again).toEqual({
      status: "already_migrated",
      commentThreadId: ctx.state.threads.all()[0]!.id,
    });
    expect(ctx.state.threads.all()).toHaveLength(1);
    expect(ctx.state.events.filter((e) => e.eventType === "replied")).toHaveLength(1);
  });

  it("数えるだけの実行（dry-run）は何も書かず、移したときと同じ内訳を返す", async () => {
    const { ctx, work, rev1 } = await setup();
    const t = addThread(ctx, work.id, { revisionId: rev1.id });
    addPost(ctx, t);
    addPost(ctx, t, { createdAt: 2_000 });
    ctx.state.feedbackReads.set(`${reviewer.userId}|${t.id}`, 3_100);
    const preview = await previewFeedbackThreadMigration(ctx, t);
    expect(preview).toEqual({
      status: "will_migrate",
      workId: work.id,
      resolution: "resolved",
      replies: 1,
      files: 0,
      filesSkipped: 0,
      reads: 1,
    });
    expect(ctx.state.threads.all()).toHaveLength(0);
    expect(ctx.state.events).toHaveLength(0);
    expect(await isFeedbackThreadSettled(ctx, t)).toBe(false);
    await migrateFeedbackThread(ctx, t);
    expect(await isFeedbackThreadSettled(ctx, t)).toBe(true);
  });

  it("移したコメントは、校了の前に解決が要る（未解決で移したもの）。解決済みはこれまでどおり判断できる", async () => {
    const { ctx, work } = await setup();
    const t = addThread(ctx, work.id);
    addPost(ctx, t);
    await migrateFeedbackThread(ctx, t);
    const [thread] = ctx.state.threads.all();
    // 採否の操作はコメントと同じ（移した後の表示用の履歴にも載る）
    await decideThread(ctx, creator, { threadId: thread!.id, action: "resolved" });
    expect(ctx.state.threads.all()[0]!.resolution).toBe("resolved");
    const events = projectThreadEvents(
      await ctx.threads.listEvents(thread!.id),
      creator.userId,
      "active",
    );
    expect(events.map((e) => e.eventType)).toEqual(["created", "decided"]);
  });
});

describe("旧 FB の URL からの行き先", () => {
  it("移したスレッドは移し先のコメントへ。移していない・削除した・見られない制作物は null", async () => {
    const { ctx, work, rev2 } = await setup();
    const secret = await seedWork(ctx, { title: "極秘" });
    await submitRevision(ctx, secret.id);
    const t = addThread(ctx, work.id);
    addPost(ctx, t);
    const hidden = addThread(ctx, secret.id);
    addPost(ctx, hidden);
    const pending = addThread(ctx, work.id);
    addPost(ctx, pending);
    await migrateFeedbackThread(ctx, t);
    await migrateFeedbackThread(ctx, hidden);
    const moved = ctx.state.threads.all().find((x) => x.migratedFromFeedbackThreadId === t.id)!;

    expect(await resolveMigratedFeedbackThread(ctx, stranger, t.id)).toEqual({
      revisionId: rev2.id,
      threadId: moved.id,
    });
    expect(await resolveMigratedFeedbackThread(ctx, stranger, pending.id)).toBeNull();
    expect(await resolveMigratedFeedbackThread(ctx, stranger, "no-such")).toBeNull();
    expect(await resolveMigratedFeedbackThread(ctx, stranger, hidden.id)).toBeNull();
    await deleteThread(ctx, creator, { threadId: moved.id });
    expect(await resolveMigratedFeedbackThread(ctx, stranger, t.id)).toBeNull();
  });
});

describe("FB の通知の行き先", () => {
  it("移したスレッドの通知は移し先のコメントへ、移していない通知は行き先を持たない。見られない制作物は伏せる", async () => {
    const { ctx, work, rev2 } = await setup();
    const secret = await seedWork(ctx, { title: "極秘ポスター" });
    const t = addThread(ctx, work.id);
    addPost(ctx, t);
    const other = addThread(ctx, work.id);
    const hidden = addThread(ctx, secret.id);
    for (const [thread, w] of [
      [t, work],
      [other, work],
      [hidden, secret],
    ] as const)
      await notify(ctx, [stranger.userId], creator.userId, {
        kind: "feedback_posted",
        title: "新しい投稿",
        body: `「${w.title}」のスレッド`,
        workId: w.id,
        threadId: thread.id,
      });
    await migrateFeedbackThread(ctx, t);
    const migrated = ctx.state.threads.all()[0]!;

    const list = await listMyNotifications(ctx, stranger);
    const find = (text: string) => list.find((n) => n.body.includes(text));
    const moved = list.find((n) => n.threadId === migrated.id)!;
    expect(moved).toMatchObject({ kind: "feedback_posted", revisionId: rev2.id, workId: work.id });
    const unmoved = list.find(
      (n) => n.kind === "feedback_posted" && !n.threadId && n.body.includes("EVE"),
    );
    expect(unmoved).toBeDefined();
    expect(unmoved).not.toHaveProperty("revisionId");
    expect(unmoved).not.toHaveProperty("workId");
    expect(find("極秘ポスター")).toBeUndefined();
    expect(list.filter((n) => n.title === "閲覧できない制作物の通知です")).toHaveLength(1);
  });
});
