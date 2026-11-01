import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness, HOUR, uploadVerified, type Harness } from "../test/harness";

type Cast = Awaited<ReturnType<typeof createCast>>;

async function setup(t: Harness, cast: Cast) {
  const workId = (await cast.manager.as.mutation(api.works.create, {
    title: "MF100 パンフレット",
    purpose: "来場者案内",
    category: "印刷物",
    mediaType: "pdf",
    year: 100,
    creatorIds: [cast.creator.id],
    approverId: cast.approver.id,
  })) as Id<"works">;
  await cast.admin.as.mutation(api.acl.grant, {
    workId,
    userIds: [cast.reviewer.id],
    permission: "review",
  });
  const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
    workId,
    kind: "standard",
    reviewType: "general",
    deadlineAt: Date.now() + 24 * HOUR,
    changeSummary: "初稿",
    focusNotes: "配色",
    items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
  });
  await uploadVerified(cast.creator, prepared.items[0]!.id, { size: 10, sha256: "a" });
  const { revisionId } = await cast.creator.as.mutation(api.submissions.confirm, {
    sessionId: prepared.sessionId as Id<"uploadSessions">,
  });
  const rid = revisionId as Id<"revisions">;
  const post = (body = "団体名が誤り") =>
    cast.reviewer.as.mutation(api.comments.post, {
      revisionId: rid,
      body,
      kind: "correction",
      severity: "info",
    }) as Promise<Id<"commentThreads">>;
  const threadOf = async (who: Cast["reviewer"], threadId: string) =>
    (await who.as.query(api.revisions.get, { revisionId: rid })).threads.find(
      (x) => x.id === threadId,
    )!;
  void t;
  return { workId, rid, post, threadOf };
}

describe("Convex 統合: コメントのスレッド（返信の件数・参加者・未読・通知）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("版の画面のスレッドに、返信の件数・参加者・最後の動き・未読が載る。読んだ印は開いた人だけに付く", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { post, threadOf } = await setup(t, cast);
    const threadId = await post();

    // 投稿者は自分の投稿で未読にならず、ほかの人には未読
    expect(await threadOf(cast.reviewer, threadId)).toMatchObject({
      unread: false,
      replyCount: 0,
      participantIds: [cast.reviewer.id],
    });
    expect((await threadOf(cast.creator, threadId)).unread).toBe(true);

    // 開いて（履歴は読んだ時刻を持つ）既読にする。他の人の未読は変わらない
    const first = await cast.creator.as.query(api.comments.events, { threadId });
    expect(first.readAt).toBeNull();
    vi.setSystemTime(Date.now() + 1000);
    await cast.creator.as.mutation(api.comments.markRead, { threadId });
    expect((await threadOf(cast.creator, threadId)).unread).toBe(false);
    expect((await cast.creator.as.query(api.comments.events, { threadId })).readAt).toBe(
      Date.now(),
    );
    expect((await threadOf(cast.approver, threadId)).unread).toBe(true);

    // 返信 → 件数・参加者・最後の動きが進み、返信した人以外は未読になる
    vi.setSystemTime(Date.now() + 1000);
    await cast.approver.as.mutation(api.comments.reply, { threadId, body: "確認します" });
    vi.setSystemTime(Date.now() + 1000);
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "対応します" });
    const seen = await threadOf(cast.reviewer, threadId);
    expect(seen).toMatchObject({ unread: true, replyCount: 2, lastActivityAt: Date.now() });
    expect(seen.participantIds).toEqual([cast.reviewer.id, cast.creator.id, cast.approver.id]);
    expect(seen.participants.map((u) => u.id)).toEqual(seen.participantIds);
    expect((await threadOf(cast.creator, threadId)).unread).toBe(false); // 最後の動きが自分
    expect((await threadOf(cast.approver, threadId)).unread).toBe(true);

    // 直近の返信が、投稿者の情報つきで古い順に載る
    expect(seen.latestReplies.map((r) => [r.body, r.authorId, r.author?.id])).toEqual([
      ["確認します", cast.approver.id, cast.approver.id],
      ["対応します", cast.creator.id, cast.creator.id],
    ]);
    expect(seen.latestReplies.map((r) => r.unread)).toEqual([true, true]);

    // 返信を削除すると件数が減り、直近の返信からも外れる
    const replies = (await cast.reviewer.as.query(api.comments.events, { threadId })).events.filter(
      (e) => e.eventType === "replied",
    );
    await cast.creator.as.mutation(api.comments.removeReply, {
      threadId,
      replyEventId: replies[1]!.id,
    });
    const removed = await threadOf(cast.reviewer, threadId);
    expect(removed).toMatchObject({ replyCount: 1 });
    expect(removed.latestReplies.map((r) => r.authorId)).toEqual([cast.approver.id]);
  });

  it("やり取りを持たない古いスレッドも、イベントから導いて返す（移行しない）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { rid, threadOf } = await setup(t, cast);
    const legacyId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("commentThreads", {
        revisionId: rid,
        authorId: cast.reviewer.id,
        body: "古いコメント",
        kind: "correction",
        severity: "info",
        resolution: "open",
        createdAt: Date.now(),
      });
      await ctx.db.insert("commentEvents", {
        threadId: id,
        eventType: "replied",
        actorId: cast.creator.id,
        payload: { body: "返信" },
        createdAt: Date.now() + 10,
      });
      return id;
    });
    expect(await threadOf(cast.reviewer, legacyId)).toMatchObject({
      unread: true,
      replyCount: 1,
      lastActivityAt: Date.now() + 10,
    });
    expect((await threadOf(cast.creator, legacyId)).unread).toBe(false);
  });

  it("返信は、投稿者と前の返信者に「返信」の通知を送る（本人・メンションした人には送らない）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { post } = await setup(t, cast);
    const threadId = await post();
    const notes = (who: Cast["reviewer"]) =>
      who.as
        .query(api.notifications.list, {})
        .then((list) => list.filter((n) => n.threadId === threadId));
    const before = (await notes(cast.reviewer)).length;

    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "対応します" });
    const afterCreator = await notes(cast.reviewer);
    expect(afterCreator).toHaveLength(before + 1);
    expect(afterCreator.at(0)).toMatchObject({ kind: "comment_posted" });

    // 承認者が返信（参加者になる）→ 主管が承認者をメンションして返信。制作者・投稿者へは「返信」、承認者へは「メンション」だけ
    const creatorBefore = (await notes(cast.creator)).length;
    const approverBefore = (await notes(cast.approver)).length;
    await cast.approver.as.mutation(api.comments.reply, { threadId, body: "確認します" });
    await cast.manager.as.mutation(api.comments.reply, {
      threadId,
      body: "@approver 私も確認します",
      mentions: [cast.approver.id],
    });
    expect((await notes(cast.creator)).length).toBe(creatorBefore + 2);
    const approverNew = (await notes(cast.approver)).slice(
      0,
      (await notes(cast.approver)).length - approverBefore,
    );
    expect(approverNew).toHaveLength(1);
    expect(approverNew[0]).toMatchObject({ kind: "mentioned" });
    // 返信した本人には送らない
    expect((await notes(cast.manager)).length).toBe(0);
  });

  it("スレッドを購読した人は、返信していなくても「返信」の通知を受け取り、外すと受け取らない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { post } = await setup(t, cast);
    const threadId = await post();
    const notes = () =>
      cast.stranger.as
        .query(api.notifications.list, {})
        .then((list) => list.filter((n) => n.threadId === threadId));
    const subscribed = async () =>
      (await cast.stranger.as.query(api.comments.events, { threadId })).subscribed;
    const rows = () =>
      t.run((ctx) =>
        ctx.db
          .query("threadSubscriptions")
          .withIndex("by_thread", (q) => q.eq("threadId", threadId))
          .collect(),
      );

    expect(await subscribed()).toBe(false);
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "対応します" });
    expect(await notes()).toHaveLength(0);

    await cast.stranger.as.mutation(api.comments.setSubscription, { threadId, on: true });
    await cast.stranger.as.mutation(api.comments.setSubscription, { threadId, on: true });
    expect(await subscribed()).toBe(true);
    expect(await rows()).toHaveLength(1);
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "直しました" });
    expect(await notes()).toMatchObject([{ kind: "comment_posted", threadId }]);

    await cast.stranger.as.mutation(api.comments.setSubscription, { threadId, on: false });
    expect(await subscribed()).toBe(false);
    expect(await rows()).toHaveLength(0);
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "もう一度" });
    expect(await notes()).toHaveLength(1);
  });
});
