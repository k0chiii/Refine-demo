import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness, HOUR, uploadVerified } from "../test/harness";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

type Cast = Awaited<ReturnType<typeof createCast>>;

async function setup(cast: Cast) {
  const workId = (await cast.manager.as.mutation(api.works.create, {
    title: "MF100 パンフレット",
    purpose: "来場者案内",
    category: "印刷物",
    mediaType: "pdf",
    year: 100,
    creatorIds: [cast.creator.id],
    approverId: cast.approver.id,
    confidentiality: "normal",
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
  const threadId = (await cast.reviewer.as.mutation(api.comments.post, {
    revisionId: rid,
    body: "団体名が誤り",
    kind: "correction",
    severity: "info",
  })) as Id<"commentThreads">;
  return { rid, threadId };
}

describe("Convex 統合: 返信の訂正と「編集済み」の印", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("返信した本人が訂正すると、流れの返信が今の本文になり印が付く。訂正できるのは本人だけ", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { threadId } = await setup(cast);
    await cast.reviewer.as.mutation(api.comments.reply, { threadId, body: "補足します" });
    const replyOf = async (who: Cast["reviewer"]) =>
      (await who.as.query(api.comments.events, { threadId })).events.find(
        (e) => e.eventType === "replied",
      )!;
    const before = await replyOf(cast.reviewer);
    expect(before).toMatchObject({ edited: false, can: { delete: true, edit: true } });

    await cast.reviewer.as.mutation(api.comments.editReply, {
      threadId,
      replyEventId: before.id,
      body: "**補足**します",
      bodyFormat: "markdown",
    });
    const after = await replyOf(cast.reviewer);
    expect(after).toMatchObject({
      id: before.id,
      payload: { body: "**補足**します", bodyFormat: "markdown" },
      edited: true,
      can: { edit: true },
    });
    const events = await cast.reviewer.as.query(api.comments.events, { threadId });
    expect(events.events.map((e) => e.eventType)).toEqual(["created", "replied"]);
    expect((await replyOf(cast.creator)).can).toEqual({ delete: false, edit: false });

    await expect(
      cast.creator.as.mutation(api.comments.editReply, {
        threadId,
        replyEventId: before.id,
        body: "書き換え",
      }),
    ).rejects.toThrow(code("comment_edit_not_author"));
  });

  it("元のコメントを訂正しても流れに記録の行は出ず、一覧のスレッドが訂正の回数と can.edit を持つ", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { rid, threadId } = await setup(cast);
    await cast.reviewer.as.mutation(api.comments.edit, {
      threadId,
      body: "団体名が誤り（3 ページ）",
      bodyFormat: "markdown",
    });
    const events = await cast.creator.as.query(api.comments.events, { threadId });
    expect(events.events.map((e) => e.eventType)).toEqual(["created"]);
    const asReviewer = await cast.reviewer.as.query(api.revisions.get, { revisionId: rid });
    expect(asReviewer.threads[0]).toMatchObject({
      editCount: 1,
      can: { delete: true, edit: true },
    });
    const asCreator = await cast.creator.as.query(api.revisions.get, { revisionId: rid });
    expect(asCreator.threads[0]!.can.edit).toBe(false);
  });
});
