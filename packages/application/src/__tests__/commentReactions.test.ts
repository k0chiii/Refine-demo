import { setWorkReviewers } from "../usecases/reviewers.ts";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { finalizeWork } from "../usecases/approvals.ts";
import {
  deleteReply,
  deleteThread,
  postComment,
  replyToThread,
  toggleCommentReaction,
} from "../usecases/comments.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

async function setup(over: Parameters<typeof seedWork>[1] = {}) {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx, over);
  const revision = await submitRevision(ctx, work.id, { deadlineInHours: 24 });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: work.id,
    userIds: [principals.reviewer.userId],
    permission: "review",
  });
  await setWorkReviewers(ctx, principals.manager, {
    workId: revision.workId,
    reviewerIds: [principals.reviewer.userId],
  });
  const post = (severity: "critical" | "info" = "info") =>
    postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "団体名が誤り",
      kind: "correction",
      severity,
    });
  const replyIds = async (threadId: string) =>
    (await ctx.threads.listEvents(threadId))
      .filter((e) => e.eventType === "replied")
      .map((e) => e.id!);
  return { ctx, work, revision, post, replyIds };
}

describe("コメント・返信へのリアクション", () => {
  it("コメントに付け外しでき、集計は人数・自分が付けたか・付けた人を返す。同じ人は同じ絵文字に 1 回だけ", async () => {
    const { ctx, post } = await setup();
    const thread = await post();
    const react = (p: typeof principals.creator, emoji: string) =>
      toggleCommentReaction(ctx, p, { threadId: thread.id, emoji });

    expect(await react(principals.creator, "👍")).toEqual([
      { emoji: "👍", count: 1, mine: true, userIds: [principals.creator.userId] },
    ]);
    const both = await react(principals.reviewer, "👍");
    expect(both).toEqual([
      {
        emoji: "👍",
        count: 2,
        mine: true,
        userIds: [principals.creator.userId, principals.reviewer.userId],
      },
    ]);
    expect((await ctx.threads.findById(thread.id))?.reactions).toEqual([
      { emoji: "👍", userIds: [principals.creator.userId, principals.reviewer.userId] },
    ]);
    // もう一度押すと外れる（二重には付かない）
    await react(principals.creator, "👍");
    expect((await ctx.threads.findById(thread.id))?.reactions).toEqual([
      { emoji: "👍", userIds: [principals.reviewer.userId] },
    ]);
    await react(principals.reviewer, "👍");
    expect((await ctx.threads.findById(thread.id))?.reactions).toBeUndefined();
  });

  it("返信にも付け外しでき、コメントのリアクションとは別に数える", async () => {
    const { ctx, post, replyIds } = await setup();
    const thread = await post();
    await replyToThread(ctx, principals.creator, { threadId: thread.id, body: "対応します" });
    const [replyId] = await replyIds(thread.id);

    await toggleCommentReaction(ctx, principals.reviewer, {
      threadId: thread.id,
      replyEventId: replyId!,
      emoji: "🙏",
    });
    const after = await toggleCommentReaction(ctx, principals.manager, {
      threadId: thread.id,
      replyEventId: replyId!,
      emoji: "🙏",
    });
    expect(after[0]).toMatchObject({ emoji: "🙏", count: 2, mine: true });
    const events = await ctx.threads.listEvents(thread.id);
    expect(events.find((e) => e.id === replyId)?.reactions).toEqual([
      { emoji: "🙏", userIds: [principals.reviewer.userId, principals.manager.userId] },
    ]);
    expect((await ctx.threads.findById(thread.id))?.reactions).toBeUndefined();

    await toggleCommentReaction(ctx, principals.reviewer, {
      threadId: thread.id,
      replyEventId: replyId!,
      emoji: "🙏",
    });
    await toggleCommentReaction(ctx, principals.manager, {
      threadId: thread.id,
      replyEventId: replyId!,
      emoji: "🙏",
    });
    expect(
      (await ctx.threads.listEvents(thread.id)).find((e) => e.id === replyId)?.reactions,
    ).toBeUndefined();
  });

  it("コメントを見られて返信できる人なら誰でも付けられる。見られない人は付けられない", async () => {
    const { ctx, work, post } = await setup({ confidentiality: "restricted" });
    const thread = await post();
    ctx.state.members.add("u_viewer");
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: ["u_viewer"],
      permission: "view",
    });
    const viewer = {
      userId: "u_viewer",
      isSystemAdmin: false,
      groupIds: [],
      orgPermissions: ["*"],
    };
    for (const p of [
      principals.creator,
      principals.manager,
      principals.approver,
      principals.reviewer,
      viewer,
    ])
      await expect(
        toggleCommentReaction(ctx, p, { threadId: thread.id, emoji: "👀" }),
      ).resolves.toBeTruthy();
    await expect(
      toggleCommentReaction(ctx, principals.stranger, { threadId: thread.id, emoji: "👀" }),
    ).rejects.toThrow(code("forbidden"));
  });

  it("決まった絵文字以外・存在しないコメント・存在しない返信は拒否する", async () => {
    const { ctx, post } = await setup();
    const thread = await post();
    await expect(
      toggleCommentReaction(ctx, principals.creator, { threadId: thread.id, emoji: "😀" }),
    ).rejects.toThrow(code("comment_reaction_invalid"));
    await expect(
      toggleCommentReaction(ctx, principals.creator, { threadId: "missing", emoji: "👍" }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      toggleCommentReaction(ctx, principals.creator, {
        threadId: thread.id,
        replyEventId: "evt-missing",
        emoji: "👍",
      }),
    ).rejects.toThrow(code("comment_reply_not_found"));
    // 返信でないイベント（作成）には付けられない
    const [created] = await ctx.threads.listEvents(thread.id);
    await expect(
      toggleCommentReaction(ctx, principals.creator, {
        threadId: thread.id,
        replyEventId: created!.id!,
        emoji: "👍",
      }),
    ).rejects.toThrow(code("comment_reply_not_found"));
  });

  it("削除されたコメント・返信には付けられない", async () => {
    const { ctx, post, replyIds } = await setup();
    const thread = await post();
    await replyToThread(ctx, principals.creator, { threadId: thread.id, body: "対応します" });
    const [replyId] = await replyIds(thread.id);
    await deleteReply(ctx, principals.creator, { threadId: thread.id, replyEventId: replyId! });
    await expect(
      toggleCommentReaction(ctx, principals.reviewer, {
        threadId: thread.id,
        replyEventId: replyId!,
        emoji: "👍",
      }),
    ).rejects.toThrow(code("comment_reply_not_found"));

    await deleteThread(ctx, principals.reviewer, { threadId: thread.id });
    await expect(
      toggleCommentReaction(ctx, principals.creator, { threadId: thread.id, emoji: "👍" }),
    ).rejects.toThrow(code("comment_thread_deleted"));
  });

  it("校了後は付けられない。通知は出さない", async () => {
    const { ctx, work, revision, post } = await setup();
    const thread = await post();
    const notified = ctx.state.notifications.all().length;
    await toggleCommentReaction(ctx, principals.creator, { threadId: thread.id, emoji: "🎉" });
    expect(ctx.state.notifications.all()).toHaveLength(notified);

    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: revision.id });
    await expect(
      toggleCommentReaction(ctx, principals.creator, { threadId: thread.id, emoji: "💡" }),
    ).rejects.toThrow(code("work_already_finalized"));
  });
});
