import type { Principal } from "@mf100/domain";
import { setWorkReviewers } from "../usecases/reviewers.ts";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { finalizeWork } from "../usecases/approvals.ts";
import {
  beginCommentFileUpload,
  completeCommentFileUpload,
  prepareCommentFiles,
} from "../usecases/commentFiles.ts";
import {
  editReply,
  markCommentRead,
  postComment,
  presentThreadActivity,
  replyToThread,
} from "../usecases/comments.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const { reviewer, creator, manager, approver, stranger, sysadmin } = principals;

async function setup() {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx);
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
  const thread = await postComment(ctx, reviewer, {
    revisionId: revision.id,
    body: "団体名が誤り",
    kind: "correction",
    severity: "info",
  });
  const [prepared] = await prepareCommentFiles(ctx, creator, {
    revisionId: revision.id,
    purpose: "reply",
    files: [{ fileName: "a.pdf", mimeType: "application/pdf", size: 1 }],
  });
  const fileId = prepared!.fileId;
  const { attemptId } = await beginCommentFileUpload(ctx, creator, { fileId });
  await completeCommentFileUpload(ctx, creator, { attemptId, size: 1, sha256: "a".repeat(64) });
  ctx.clock.current += HOUR;
  await replyToThread(ctx, creator, {
    threadId: thread.id,
    body: "直します",
    mentions: [approver.userId],
    fileIds: [fileId],
  });
  const events = () => ctx.threads.listEvents(thread.id);
  const replyId = (await events()).find((e) => e.eventType === "replied")!.id!;
  const edit = (who: Principal, body: string) =>
    editReply(ctx, who, {
      threadId: thread.id,
      replyEventId: replyId,
      body,
      bodyFormat: "markdown",
    });
  return { ctx, work, revision, thread, fileId, replyId, events, edit };
}

describe("返信の訂正", () => {
  it("返信の本文を置き換え、メンションと添付はそのまま。訂正前の本文を reply_edited に残す", async () => {
    const { fileId, replyId, events, edit } = await setup();
    await edit(creator, "**直しました**");
    const after = await events();
    expect(after.find((e) => e.id === replyId)!.payload).toEqual({
      body: "**直しました**",
      bodyFormat: "markdown",
      mentions: [approver.userId],
      fileIds: [fileId],
    });
    const records = after.filter((e) => e.eventType === "reply_edited");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actorId: creator.userId,
      payload: { replyEventId: replyId, previousBody: "直します", bodyFormat: "markdown" },
    });
    expect(records[0]!.payload).not.toHaveProperty("previousBodyFormat");
  });

  it("訂正は動きに数えない（最後の動き・返信の件数・ほかの人の未読・通知が変わらない）", async () => {
    const { ctx, thread, edit } = await setup();
    await markCommentRead(ctx, reviewer, { threadId: thread.id });
    const before = (await ctx.threads.findById(thread.id))!;
    const notifications = ctx.state.notifications.all().length;
    ctx.clock.current += HOUR;
    await edit(creator, "直しました");
    const after = (await ctx.threads.findById(thread.id))!;
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    expect(after.lastActivityBy).toBe(creator.userId);
    expect(after.replyCount).toBe(1);
    const view = await presentThreadActivity(ctx, reviewer, [after]);
    expect(view.get(thread.id)).toMatchObject({ unread: false, replyCount: 1 });
    expect(ctx.state.notifications.all()).toHaveLength(notifications);
  });

  it("返信した本人以外は訂正できない。校了後は本人も訂正できない。同じ本文での訂正は記録を増やさない", async () => {
    const { ctx, work, revision, events, edit } = await setup();
    for (const who of [reviewer, manager, approver, stranger, sysadmin])
      await expect(edit(who, "書き換え")).rejects.toThrow(code("comment_edit_not_author"));

    await edit(creator, "直しました");
    await edit(creator, "直しました");
    expect((await events()).filter((e) => e.eventType === "reply_edited")).toHaveLength(1);

    await finalizeWork(ctx, approver, { workId: work.id, revisionId: revision.id });
    await expect(edit(creator, "校了後")).rejects.toThrow(code("work_already_finalized"));
    expect((await events()).filter((e) => e.eventType === "reply_edited")).toHaveLength(1);
  });
});
