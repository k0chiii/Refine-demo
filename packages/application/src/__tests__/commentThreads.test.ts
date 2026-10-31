import { setWorkReviewers } from "../usecases/reviewers.ts";
import { notificationCategoryOf } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission, revokeWorkPermission } from "../usecases/acl.ts";
import {
  decideThread,
  deleteReply,
  deleteThread,
  markCommentRead,
  postComment,
  presentThreadActivity,
  replyToThread,
  setThreadSubscription,
} from "../usecases/comments.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const { reviewer, creator, manager, approver, stranger } = principals;

async function setup(confidentiality: "normal" | "restricted" = "normal") {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx, { confidentiality });
  const revision = await submitRevision(ctx, work.id, { deadlineInHours: 24 });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: work.id,
    userIds: [reviewer.userId],
    permission: "review",
  });
  await setWorkReviewers(ctx, manager, {
    workId: revision.workId,
    reviewerIds: [reviewer.userId],
  });
  /** コメントを立てたときまでに届いていた通知（「新しいコメント」。返信の通知と分ける） */
  const baseline = new Set<string>();
  const post = async (body = "団体名が誤り") => {
    const t = await postComment(ctx, reviewer, {
      revisionId: revision.id,
      body,
      kind: "correction",
      severity: "major",
    });
    for (const n of ctx.state.notifications.all()) baseline.add(n.id);
    return t;
  };
  const reply = (threadId: string, who: typeof reviewer, body = "返信", mentions?: string[]) =>
    replyToThread(ctx, who, { threadId, body, ...(mentions ? { mentions } : {}) });
  /** 返信の通知（コメントを立てた後に、スレッドに付いた「コメント」の通知）の受信者と種類 */
  const replyNotes = (threadId: string) =>
    ctx.state.notifications
      .all()
      .filter((n) => n.threadId === threadId && n.kind === "comment_posted" && !baseline.has(n.id))
      .map((n) => `${n.recipientId}:${n.kind}`)
      .sort();
  const view = async (who: typeof reviewer, threadId: string) => {
    const threads = (await ctx.threads.listByRevision(revision.id)).filter(
      (t) => t.id === threadId,
    );
    return (await presentThreadActivity(ctx, who, threads)).get(threadId)!;
  };
  return { ctx, work, revision, post, reply, replyNotes, view };
}

describe("コメントのスレッド: 返信の件数・参加者・未読", () => {
  it("投稿した直後は返信なし・投稿者だけが参加者。投稿者本人は未読にならず、ほかの人には未読", async () => {
    const { ctx, post, view } = await setup();
    ctx.clock.current += HOUR;
    const t = await post();
    expect(t).toMatchObject({ replyCount: 0, participantIds: [reviewer.userId] });
    expect(t.lastActivityAt).toBe(ctx.clock.now());
    expect(await view(reviewer, t.id)).toMatchObject({ unread: false, replyCount: 0 });
    expect(await view(creator, t.id)).toMatchObject({ unread: true, replyCount: 0 });
  });

  it("返信すると件数・参加者・最後の動きが進み、返信した本人は未読にならず、ほかの参加者は未読になる", async () => {
    const { ctx, post, reply, view } = await setup();
    const t = await post();
    // 制作者が開いて読んだ → 既読
    ctx.clock.current += 1000;
    await markCommentRead(ctx, creator, { threadId: t.id });
    expect(await view(creator, t.id)).toMatchObject({ unread: false });

    ctx.clock.current += 1000;
    await reply(t.id, manager);
    ctx.clock.current += 1000;
    await reply(t.id, reviewer, "再返信");
    const v = await view(creator, t.id);
    expect(v).toMatchObject({ unread: true, replyCount: 2, lastActivityAt: ctx.clock.now() });
    expect(v.participantIds).toEqual([reviewer.userId, manager.userId]);
    // 自分の返信が最後の動きの人（返信者）は未読にならない。返信していない人（制作者）は未読
    expect(await view(reviewer, t.id)).toMatchObject({ unread: false });
    expect((await view(manager, t.id)).unread).toBe(true);

    // 開くと既読。もう一度返信が来ると、また未読
    ctx.clock.current += 1000;
    await markCommentRead(ctx, creator, { threadId: t.id });
    expect((await view(creator, t.id)).unread).toBe(false);
    ctx.clock.current += 1000;
    await reply(t.id, manager, "もう一件");
    expect((await view(creator, t.id)).unread).toBe(true);
  });

  it("返信を削除すると件数・参加者・最後の動きは残った返信から数え直す。採否は動きに数えない", async () => {
    const { ctx, post, reply, view } = await setup();
    const t = await post();
    ctx.clock.current += 1000;
    await reply(t.id, manager);
    ctx.clock.current += 1000;
    await reply(t.id, creator);
    const ids = (await ctx.threads.listEvents(t.id))
      .filter((e) => e.eventType === "replied")
      .map((e) => e.id!);
    ctx.clock.current += 1000;
    await deleteReply(ctx, creator, { threadId: t.id, replyEventId: ids[1]! });
    const after = await view(reviewer, t.id);
    expect(after).toMatchObject({ replyCount: 1 });
    expect(after.participantIds).toEqual([reviewer.userId, manager.userId]);
    // 採否はスレッドを開かなくても行えるので、動き（未読）に数えない
    const readAt = ctx.clock.now();
    await markCommentRead(ctx, reviewer, { threadId: t.id });
    ctx.clock.current += 1000;
    await decideThread(ctx, creator, { threadId: t.id, action: "accepted" });
    expect(await ctx.threads.readAt(reviewer.userId, t.id)).toBeGreaterThanOrEqual(readAt);
    expect((await view(reviewer, t.id)).unread).toBe(false);
  });

  it("直近の返信は、削除されていない最後の 3 件を古い順に返す。返信が無ければ空。未読は他の人の新しい返信だけ", async () => {
    const { ctx, post, reply, view } = await setup();
    const t = await post();
    expect((await view(creator, t.id)).latestReplies).toEqual([]);
    const bodies = ["一", "二", "三", "四", "五"];
    for (const [i, b] of bodies.entries()) {
      ctx.clock.current += 1000;
      await reply(t.id, i % 2 === 0 ? manager : creator, b);
    }
    const v = await view(reviewer, t.id);
    expect(v.replyCount).toBe(5);
    expect(v.latestReplies.map((r) => r.body)).toEqual(["三", "四", "五"]);
    expect(v.latestReplies.map((r) => r.authorId)).toEqual([
      manager.userId,
      creator.userId,
      manager.userId,
    ]);
    expect(v.latestReplies.every((r) => r.fileCount === 0 && r.firstFile === null)).toBe(true);
    // 投稿者(reviewer)は読んでいない他の人の返信が未読。制作者は自分が返信した時点で読んでいるので、その後の返信だけが未読
    expect(v.latestReplies.every((r) => r.unread)).toBe(true);
    expect((await view(creator, t.id)).latestReplies.map((r) => r.unread)).toEqual([
      false,
      false,
      true,
    ]);
    // 読めば未読は消える
    ctx.clock.current += 1000;
    await markCommentRead(ctx, reviewer, { threadId: t.id });
    expect((await view(reviewer, t.id)).latestReplies.some((r) => r.unread)).toBe(false);

    // 削除した返信は含めず、さかのぼって残りの返信が入る
    const ids = (await ctx.threads.listEvents(t.id))
      .filter((e) => e.eventType === "replied")
      .map((e) => e.id!);
    ctx.clock.current += 1000;
    await deleteReply(ctx, creator, { threadId: t.id, replyEventId: ids[3]! });
    const after = await view(reviewer, t.id);
    expect(after.replyCount).toBe(4);
    expect(after.latestReplies.map((r) => r.body)).toEqual(["二", "三", "五"]);
  });

  it("やり取りを持たない古いスレッドはイベントから導く（移行しない）。自分の投稿は未読にならない", async () => {
    const { ctx, revision, view } = await setup();
    const legacy = await ctx.threads.insert({
      revisionId: revision.id,
      authorId: reviewer.userId,
      body: "古いコメント",
      kind: "correction",
      severity: "major",
      resolution: "open",
      createdAt: ctx.clock.now(),
    });
    await ctx.threads.appendEvent({
      threadId: legacy.id,
      eventType: "created",
      actorId: reviewer.userId,
      createdAt: legacy.createdAt,
    });
    await ctx.threads.appendEvent({
      threadId: legacy.id,
      eventType: "replied",
      actorId: creator.userId,
      payload: { body: "返信" },
      createdAt: legacy.createdAt + 10,
    });
    expect(legacy.replyCount).toBeUndefined();
    expect(await view(reviewer, legacy.id)).toMatchObject({
      unread: true, // 他の人の返信が最後の動き・読んだことが無い
      replyCount: 1,
      lastActivityAt: legacy.createdAt + 10,
      participantIds: [reviewer.userId, creator.userId],
    });
    expect((await view(creator, legacy.id)).unread).toBe(false); // 最後の動きが自分
    // 返信が付くとスレッドが値を持つ
    await replyToThread(ctx, manager, { threadId: legacy.id, body: "別の返信" });
    expect((await ctx.threads.findById(legacy.id))?.replyCount).toBe(2);
  });

  it("読んだ印は見られる人だけが付けられ、削除済みのスレッドには付けられない", async () => {
    const { ctx, post } = await setup("restricted");
    const t = await post();
    await expect(markCommentRead(ctx, stranger, { threadId: t.id })).rejects.toThrow(
      code("forbidden"),
    );
    await deleteThread(ctx, reviewer, { threadId: t.id });
    await expect(markCommentRead(ctx, creator, { threadId: t.id })).rejects.toThrow(
      code("comment_thread_deleted"),
    );
  });
});

describe("返信の通知: スレッドの参加者へ", () => {
  it("投稿者と前の返信者に「返信」を送り、返信した本人には送らない", async () => {
    const { post, reply, replyNotes } = await setup();
    const t = await post();
    await reply(t.id, creator);
    expect(replyNotes(t.id)).toEqual([`${reviewer.userId}:comment_posted`]);
    await reply(t.id, manager);
    expect(replyNotes(t.id)).toEqual(
      [
        `${reviewer.userId}:comment_posted`,
        `${reviewer.userId}:comment_posted`,
        `${creator.userId}:comment_posted`,
      ].sort(),
    );
    // 投稿者が返信すると、これまでの返信者（制作者・主管）へ
    await reply(t.id, reviewer, "ありがとうございます");
    const toCreator = replyNotes(t.id).filter((n) => n.startsWith(creator.userId));
    expect(toCreator).toHaveLength(2);
    expect(replyNotes(t.id).filter((n) => n.startsWith(manager.userId))).toHaveLength(1);
  });

  it("メンションした人には「メンション」だけ（返信の通知は重ねない）。参加者でない人には送らない", async () => {
    const { ctx, post, reply, replyNotes } = await setup();
    const t = await post();
    await reply(t.id, creator);
    const before = replyNotes(t.id).length;
    await reply(t.id, manager, "@制作者 見てください", [creator.userId, approver.userId]);
    // 返信の通知はメンションされた制作者には行かず、投稿者だけ。メンションは別の種類で届く
    expect(replyNotes(t.id).length).toBe(before + 1);
    const mentioned = ctx.state.notifications
      .all()
      .filter((n) => n.kind === "mentioned" && n.threadId === t.id)
      .map((n) => n.recipientId)
      .sort();
    expect(mentioned).toEqual([approver.userId, creator.userId].sort());
    // 参加者でも宛先でもない承認者に「返信」は行かない
    expect(replyNotes(t.id).some((n) => n.startsWith(approver.userId))).toBe(false);
  });

  it("返信を消した人（その人の返信が残っていない）には送らない", async () => {
    const { ctx, post, reply, replyNotes } = await setup();
    const t = await post();
    await reply(t.id, creator);
    const id = (await ctx.threads.listEvents(t.id)).find((e) => e.eventType === "replied")!.id!;
    await deleteReply(ctx, creator, { threadId: t.id, replyEventId: id });
    await reply(t.id, manager);
    expect(replyNotes(t.id).some((n) => n.startsWith(creator.userId))).toBe(false);
  });

  it("非公開の制作物で、今は見られなくなった参加者には送らない（伏せた通知も作らない）", async () => {
    const { ctx, work, post, reply, replyNotes } = await setup("restricted");
    const t = await post();
    await revokeWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userId: reviewer.userId,
    });
    await reply(t.id, creator);
    expect(replyNotes(t.id)).toEqual([]);
  });

  it("通知は端末の通知の「返信・コメント」の分類（設定で止められる）で、スレッドごとにまとまる", async () => {
    const { ctx, post, reply } = await setup();
    const t = await post();
    await reply(t.id, creator);
    const note = ctx.state.notifications
      .all()
      .find((n) => n.recipientId === reviewer.userId && n.threadId === t.id)!;
    expect(note).toMatchObject({ kind: "comment_posted", threadId: t.id });
    expect(notificationCategoryOf(note.kind)).toBe("reply");
  });
});

describe("スレッドの購読: 参加していなくても返信の通知を受け取る", () => {
  it("購読した人は、返信していなくても「返信」を受け取り、外すと受け取らない", async () => {
    const { ctx, post, reply, replyNotes } = await setup();
    const t = await post();
    const toStranger = () => replyNotes(t.id).filter((n) => n.startsWith(stranger.userId));
    await reply(t.id, creator);
    expect(toStranger()).toEqual([]);
    await setThreadSubscription(ctx, stranger, { threadId: t.id, on: true });
    await reply(t.id, creator);
    expect(toStranger()).toEqual([`${stranger.userId}:comment_posted`]);
    await setThreadSubscription(ctx, stranger, { threadId: t.id, on: false });
    await reply(t.id, manager);
    expect(toStranger()).toHaveLength(1);
  });

  it("2 回購読しても 1 回外せば受け取らない。購読していない人が外しても何も起きない", async () => {
    const { ctx, post, reply, replyNotes } = await setup();
    const t = await post();
    const toStranger = () => replyNotes(t.id).filter((n) => n.startsWith(stranger.userId));
    await setThreadSubscription(ctx, approver, { threadId: t.id, on: false });
    await setThreadSubscription(ctx, stranger, { threadId: t.id, on: true });
    await setThreadSubscription(ctx, stranger, { threadId: t.id, on: true });
    expect(await ctx.threads.listSubscribers(t.id)).toEqual([stranger.userId]);
    await reply(t.id, creator);
    expect(toStranger()).toHaveLength(1);
    await setThreadSubscription(ctx, stranger, { threadId: t.id, on: false });
    expect(await ctx.threads.isSubscribed(stranger.userId, t.id)).toBe(false);
    await reply(t.id, creator);
    expect(toStranger()).toHaveLength(1);
    expect(replyNotes(t.id).some((n) => n.startsWith(approver.userId))).toBe(false);
  });

  it("非公開の制作物で、購読した後に見られなくなった人には送らない（伏せた通知も作らない）", async () => {
    const { ctx, work, post, reply } = await setup("restricted");
    const t = await post();
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [stranger.userId],
      permission: "review",
    });
    await setThreadSubscription(ctx, stranger, { threadId: t.id, on: true });
    await reply(t.id, creator);
    const toStranger = () =>
      ctx.state.notifications.all().filter((n) => n.recipientId === stranger.userId);
    expect(toStranger()).toMatchObject([{ kind: "comment_posted", threadId: t.id }]);
    await revokeWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userId: stranger.userId,
    });
    await reply(t.id, creator);
    expect(toStranger()).toHaveLength(1);
  });

  it("見られない人は購読できず、削除されたスレッドは購読できない", async () => {
    const { ctx, post } = await setup("restricted");
    const t = await post();
    await expect(
      setThreadSubscription(ctx, stranger, { threadId: t.id, on: true }),
    ).rejects.toThrow(code("forbidden"));
    await deleteThread(ctx, reviewer, { threadId: t.id });
    await expect(setThreadSubscription(ctx, creator, { threadId: t.id, on: true })).rejects.toThrow(
      code("comment_thread_deleted"),
    );
  });
});
