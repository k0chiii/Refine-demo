import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, HOUR, type Harness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

/** FB の時刻（コメントの未読を数え始めた後の時刻にする） */
const T = Date.UTC(2026, 10, 1, 6, 0, 0);
const FB_KEY = "feedback/w1/f1/案A.pdf/attempts/att1";

/** 旧 FB のデータ（機能は廃止したので、表へ直接書いて再現する） */
async function seedFeedback() {
  const t = createHarness();
  const cast = await createCast(t);
  const workId = await setupWork(t, cast);
  const first = await submitFiles(cast, workId, [
    { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" },
  ]);
  vi.setSystemTime(Date.now() + HOUR);
  const second = await submitFiles(cast, workId, [
    { fileName: "b.pdf", mimeType: "application/pdf", type: "pdf" },
  ]);
  const emptyWorkId = await setupWork(t, cast, { title: "版の無い制作物" });
  const users = {
    creator: cast.creator.id as string,
    reviewer: cast.reviewer.id as string,
    stranger: cast.stranger.id as string,
  };

  const ids = await t.run(async (ctx) => {
    const thread = async (
      work: Id<"works">,
      over: Partial<{
        title: string;
        revisionId: string;
        anchor: never;
        deletedAt: number;
        postCount: number;
      }> = {},
    ) =>
      ctx.db.insert("feedbackThreads", {
        workId: work,
        title: "配色の方向性",
        createdBy: users.creator,
        createdAt: T + 1_000,
        lastPostAt: T + 3_000,
        postCount: 2,
        participantIds: [users.creator, users.reviewer],
        ...over,
      });
    const post = async (
      threadId: Id<"feedbackThreads">,
      work: Id<"works">,
      over: Partial<{
        authorId: string;
        body: string;
        mentions: string[];
        fileIds: string[];
        createdAt: number;
        reactions: Array<{ emoji: string; userIds: string[] }>;
        deletedAt: number;
      }> = {},
    ) =>
      ctx.db.insert("feedbackPosts", {
        threadId,
        workId: work,
        authorId: users.creator,
        body: "配色の意図です",
        mentions: [],
        fileIds: [],
        reactions: [],
        createdAt: T + 1_000,
        ...over,
      });
    const file = await ctx.db.insert("feedbackFiles", {
      workId,
      uploaderId: users.creator,
      fileName: "案A.pdf",
      mimeType: "application/pdf",
      type: "pdf",
      declaredSize: 10,
      size: 10,
      sha256: "abc",
      keyPrefix: "feedback/w1/f1/案A.pdf",
      objectKey: FB_KEY,
      status: "verified",
      createdAt: 500,
    });
    // 最新の受付中の版への FB（未解決で移る）。場所つき・添付つき・題名を明示
    const latest = await thread(workId, {
      revisionId: second.revisionId,
      anchor: {
        type: "pdf_rect",
        artifactId: second.artifacts[0]!.id,
        page: 1,
        rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      } as never,
    });
    const p1 = await post(latest, workId, {
      body: "* 余白を詰めたい",
      mentions: [users.reviewer],
      fileIds: [file],
      reactions: [{ emoji: "👍", userIds: [users.reviewer] }],
    });
    await ctx.db.patch("feedbackFiles", file, { postId: p1 });
    await post(latest, workId, {
      authorId: users.reviewer,
      body: "了解です",
      createdAt: T + 2_000,
      mentions: [users.creator],
      reactions: [{ emoji: "🎉", userIds: [users.creator] }],
    });
    await post(latest, workId, {
      authorId: users.stranger,
      body: "消した投稿",
      createdAt: T + 2_500,
      deletedAt: 9,
    });
    await ctx.db.insert("feedbackReads", {
      userId: users.reviewer,
      threadId: latest,
      readAt: T + 3_100,
    });
    await ctx.db.insert("feedbackReads", {
      userId: users.stranger,
      threadId: latest,
      readAt: T + 1_500,
    });
    // 古い版への FB（解決済みで移る）。版を持たない FB も古い扱いにならず最新の版へ
    const older = await thread(workId, { revisionId: first.revisionId, title: "古い版の相談" });
    await post(older, workId);
    await post(older, workId, { authorId: users.reviewer, createdAt: T + 2_000 });
    const noRevisionField = await thread(workId);
    await post(noRevisionField, workId, { body: "版を指定しない FB" });
    await post(noRevisionField, workId, { authorId: users.reviewer, createdAt: T + 2_000 });
    // 対象外: 削除済み・制作物に版が無い
    const deleted = await thread(workId, { deletedAt: 5 });
    await post(deleted, workId);
    const noRevision = await thread(emptyWorkId);
    await post(noRevision, emptyWorkId);
    await ctx.db.insert("notifications", {
      recipientId: users.stranger,
      kind: "feedback_posted",
      title: "新しい投稿",
      body: "「MF100 パンフレット」のスレッド",
      workId,
      threadId: latest,
      createdAt: T + 4_000,
    });
    await ctx.db.insert("notifications", {
      recipientId: users.stranger,
      kind: "feedback_mentioned",
      title: "メンション",
      body: "「版の無い制作物」のスレッド",
      workId: emptyWorkId,
      threadId: noRevision,
      createdAt: T + 4_100,
    });
    return { latest, older, noRevisionField, deleted, noRevision, file };
  });
  return { t, cast, workId, first, second, ids, users };
}

const summary = (t: Harness, mode: "dry-run" | "migrate" | "delete") =>
  t.action(internal.feedbackMigration.run, { mode });
const count = (
  t: Harness,
  table: "commentThreads" | "commentEvents" | "commentFiles" | "commentReads",
) => t.run(async (ctx) => (await ctx.db.query(table).collect()).length);

describe("Convex 統合: FB のコメントへの移行", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dry-run は何も書かず、移したときの件数と制作物ごとの数を返す", async () => {
    const { t, workId } = await seedFeedback();
    const before = await count(t, "commentThreads");
    const r = await summary(t, "dry-run");
    expect(r).toMatchObject({
      mode: "dry-run",
      completed: true,
      counts: {
        scanned: 5,
        threads: 3,
        replies: 3,
        files: 1,
        reads: 2,
        skippedNoRevision: 1,
        skippedNotLive: 1,
        alreadyMigrated: 0,
        willBeOpen: 2,
        willBeResolved: 1,
      },
      topWorks: [{ workId, threads: 3 }],
    });
    expect(await count(t, "commentThreads")).toBe(before);
    expect(await count(t, "commentEvents")).toBe(0);
    expect(await count(t, "commentFiles")).toBe(0);
  });

  it("migrate: コメント・返信・添付・既読が移る。未解決は最新の受付中の版だけ、それ以外は解決済み", async () => {
    const { t, cast, workId, first, second, ids, users } = await seedFeedback();
    const r = await summary(t, "migrate");
    expect(r).toMatchObject({
      completed: true,
      counts: { threads: 3, replies: 3, files: 1, reads: 2, open: 2, resolved: 1 },
    });

    await t.run(async (ctx) => {
      const threads = await ctx.db.query("commentThreads").collect();
      expect(threads).toHaveLength(3);
      const of = (fb: Id<"feedbackThreads">) =>
        threads.find((x) => x.migratedFromFeedbackThreadId === fb)!;
      const latest = of(ids.latest);
      expect(latest).toMatchObject({
        revisionId: second.revisionId,
        authorId: users.creator,
        body: "【配色の方向性】\n* 余白を詰めたい",
        kind: "correction",
        severity: "major",
        resolution: "open",
        createdAt: T + 1_000,
        mentions: [users.reviewer],
        reactions: [{ emoji: "👍", userIds: [users.reviewer] }],
        lastActivityAt: T + 2_000,
        lastActivityBy: users.reviewer,
        replyCount: 1,
        participantIds: [users.creator, users.reviewer],
      });
      expect(latest.bodyFormat).toBeUndefined();
      expect(latest.anchor).toMatchObject({ type: "pdf_rect", page: 1 });
      expect(latest.artifactId).toBe(second.artifacts[0]!.id);
      expect(latest.fileIds).toHaveLength(1);

      const older = of(ids.older);
      expect(older).toMatchObject({ revisionId: first.revisionId, resolution: "resolved" });
      const noField = of(ids.noRevisionField);
      expect(noField).toMatchObject({ revisionId: second.revisionId, resolution: "open" });
      expect(of(ids.deleted)).toBeUndefined();
      expect(of(ids.noRevision)).toBeUndefined();

      const events = await ctx.db
        .query("commentEvents")
        .withIndex("by_thread", (q) => q.eq("threadId", latest._id))
        .collect();
      expect(events.map((e) => e.eventType)).toEqual(["created", "replied"]);
      expect(events[1]).toMatchObject({
        actorId: users.reviewer,
        createdAt: T + 2_000,
        payload: { body: "了解です", mentions: [users.creator] },
        reactions: [{ emoji: "🎉", userIds: [users.creator] }],
      });
      const olderEvents = await ctx.db
        .query("commentEvents")
        .withIndex("by_thread", (q) => q.eq("threadId", older._id))
        .collect();
      expect(olderEvents.map((e) => e.eventType)).toEqual(["created", "replied", "decided"]);
      expect(olderEvents[2]).toMatchObject({
        actorId: "system",
        payload: { from: "open", to: "resolved" },
      });

      const reads = await ctx.db
        .query("commentReads")
        .withIndex("by_user_thread", (q) =>
          q.eq("userId", users.reviewer).eq("threadId", latest._id),
        )
        .collect();
      expect(reads.map((x) => x.readAt)).toEqual([T + 3_100]);
      expect((await ctx.db.query("commentReads").collect()).length).toBe(2);

      const [file] = await ctx.db
        .query("commentFiles")
        .withIndex("by_thread_abandoned_created", (q) => q.eq("threadId", latest._id))
        .collect();
      expect(file).toMatchObject({
        objectKey: FB_KEY,
        status: "verified",
        fileName: "案A.pdf",
        workId,
        uploaderId: users.creator,
      });
      expect(file!.thumbObjectKey).toBeUndefined();
      expect(latest.fileIds).toEqual([file!._id]);
    });

    // コメントの画面と同じ API で読める（移した添付の認可・一覧の未読・履歴）
    const fileId = await t.run(async (ctx) => (await ctx.db.query("commentFiles").first())!._id);
    expect(
      await cast.stranger.as.query(api.commentFiles.authorizeFile, { fileId, variant: "original" }),
    ).toMatchObject({ objectKey: FB_KEY, fileName: "案A.pdf" });
    const rev = await cast.creator.as.query(api.revisions.get, { revisionId: second.revisionId });
    const shown = rev.threads.find((x) => x.migratedFromFeedbackThreadId === ids.latest);
    expect(shown).toMatchObject({ replyCount: 1, unread: true });
    const detail = await cast.stranger.as.query(api.comments.events, {
      threadId: shown!.id as Id<"commentThreads">,
    });
    expect(detail.events.map((e) => e.eventType)).toEqual(["created", "replied"]);
  });

  it("二度流しても増えない。移行済みは alreadyMigrated に数える", async () => {
    const { t } = await seedFeedback();
    await summary(t, "migrate");
    const threads = await count(t, "commentThreads");
    const events = await count(t, "commentEvents");
    const again = await summary(t, "migrate");
    expect(again).toMatchObject({
      counts: { threads: 0, alreadyMigrated: 3, skippedNoRevision: 1, skippedNotLive: 1 },
    });
    expect(await count(t, "commentThreads")).toBe(threads);
    expect(await count(t, "commentEvents")).toBe(events);
    expect(await count(t, "commentFiles")).toBe(1);
    // 移した後の dry-run は、移すものが残っていないと示す
    expect(await summary(t, "dry-run")).toMatchObject({
      counts: { threads: 0, alreadyMigrated: 3 },
    });
  });

  it("旧 FB の通知は移し先のコメントへ辿れる。移していないものは行き先を持たない", async () => {
    const { t, cast, second, ids } = await seedFeedback();
    await summary(t, "migrate");
    const comment = await t.run(async (ctx) =>
      ctx.db
        .query("commentThreads")
        .withIndex("by_migrated_from", (q) => q.eq("migratedFromFeedbackThreadId", ids.latest))
        .unique(),
    );
    const list = await cast.stranger.as.query(api.notifications.list, {});
    const moved = list.find((n) => n.kind === "feedback_posted")!;
    expect(moved).toMatchObject({
      threadId: comment!._id,
      revisionId: second.revisionId,
    });
    const unmoved = list.find((n) => n.kind === "feedback_mentioned")!;
    expect(unmoved).not.toHaveProperty("threadId");
    expect(unmoved).not.toHaveProperty("revisionId");
    // 旧 FB の URL（/feedback/{スレッド}）からも移し先のコメントを引ける
    expect(
      await cast.stranger.as.query(api.comments.migratedFromFeedback, {
        feedbackThreadId: ids.latest,
      }),
    ).toEqual({ revisionId: second.revisionId, threadId: comment!._id });
    expect(
      await cast.stranger.as.query(api.comments.migratedFromFeedback, {
        feedbackThreadId: ids.noRevision,
      }),
    ).toBeNull();
  });

  it("delete は、移っていないスレッドがあれば何も消さない。移した後は FB の行を全て消し、コメントと添付の実体は残す", async () => {
    const { t, cast } = await seedFeedback();
    const refused = await summary(t, "delete");
    expect(refused).toMatchObject({ refused: true, unsettledThreads: 3 });
    expect(refused).not.toHaveProperty("deleted");
    const rows = (table: "feedbackThreads" | "feedbackPosts" | "feedbackFiles" | "feedbackReads") =>
      t.run(async (ctx) => (await ctx.db.query(table).collect()).length);
    expect(await rows("feedbackThreads")).toBe(5);

    await summary(t, "migrate");
    const done = await summary(t, "delete");
    expect(done).toMatchObject({
      completed: true,
      deleted: { feedbackReads: 2, feedbackFiles: 1, feedbackPosts: 9, feedbackThreads: 5 },
    });
    for (const table of [
      "feedbackThreads",
      "feedbackPosts",
      "feedbackFiles",
      "feedbackReads",
    ] as const)
      expect(await rows(table)).toBe(0);
    expect(await count(t, "commentThreads")).toBe(3);
    expect(await count(t, "commentFiles")).toBe(1);

    // 消した後も、移した添付は読める。R2 の清掃は、移した添付の実体を消す対象にしない
    const file = await t.run(async (ctx) => (await ctx.db.query("commentFiles").first())!);
    expect(
      await cast.creator.as.query(api.commentFiles.authorizeFile, {
        fileId: file._id,
        variant: "original",
      }),
    ).toMatchObject({ objectKey: FB_KEY });
    const orphans = await t.mutation(internal.submissions.listOrphanObjects, { limit: 100 });
    expect(JSON.stringify(orphans)).not.toContain(FB_KEY);

    // 二度目の delete は何も無く、移行も何も増やさない
    expect(await summary(t, "delete")).toMatchObject({
      deleted: { feedbackThreads: 0, feedbackPosts: 0 },
    });
    expect(await summary(t, "migrate")).toMatchObject({ counts: { scanned: 0, threads: 0 } });
  });

  it("移したコメントを削除すると、清掃の対象は移した添付のキー（feedback/…）。FB の清掃の印は読み捨てる", async () => {
    const { t, cast } = await seedFeedback();
    await summary(t, "migrate");
    await summary(t, "delete");
    const thread = await t.run(async (ctx) =>
      (await ctx.db.query("commentThreads").collect()).find((x) => (x.fileIds ?? []).length > 0),
    );
    await cast.creator.as.mutation(api.comments.remove, { threadId: thread!._id });
    const orphans = (await t.mutation(internal.submissions.listOrphanObjects, {
      limit: 100,
    })) as Array<{ itemId: string; objectKey: string }>;
    expect(orphans.map((o) => o.objectKey)).toContain(FB_KEY);
    // 旧 FB の印（feedback:）は何も記録せず無視する
    expect(
      await t.mutation(internal.submissions.markObjectsPurged, { itemIds: ["feedback:x"] }),
    ).toBe(0);
  });

  it("バッチをまたいでも全部移る（カーソルで続きから。削除も複数のバッチで消しきる）", async () => {
    const { t, workId, users } = await seedFeedback();
    await t.run(async (ctx) => {
      for (let i = 0; i < 27; i++) {
        const id = await ctx.db.insert("feedbackThreads", {
          workId,
          title: `相談 ${i}`,
          createdBy: users.creator,
          createdAt: T + i,
          lastPostAt: T + i,
          postCount: 1,
          participantIds: [users.creator],
        });
        await ctx.db.insert("feedbackPosts", {
          threadId: id,
          workId,
          authorId: users.creator,
          body: `本文 ${i}`,
          mentions: [],
          fileIds: [],
          reactions: [],
          createdAt: T + i,
        });
      }
    });
    const r = await summary(t, "migrate");
    expect(r).toMatchObject({ counts: { scanned: 32, threads: 30 } });
    expect(await count(t, "commentThreads")).toBe(30);
    expect(await summary(t, "migrate")).toMatchObject({
      counts: { threads: 0, alreadyMigrated: 30 },
    });
    const done = await summary(t, "delete");
    expect(done).toMatchObject({ deleted: { feedbackThreads: 32 } });
  });
});
