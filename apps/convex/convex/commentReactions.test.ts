import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness, HOUR, uploadVerified, type Harness } from "../test/harness";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

type Cast = Awaited<ReturnType<typeof createCast>>;

async function setup(t: Harness, cast: Cast, confidentiality: "normal" | "restricted" = "normal") {
  const workId = (await cast.manager.as.mutation(api.works.create, {
    title: "MF100 パンフレット",
    purpose: "来場者案内",
    category: "印刷物",
    mediaType: "pdf",
    year: 100,
    creatorIds: [cast.creator.id],
    approverId: cast.approver.id,
    confidentiality,
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
  const view = (who: Cast["reviewer"]) => who.as.query(api.revisions.get, { revisionId: rid });
  const events = (who: Cast["reviewer"]) => who.as.query(api.comments.events, { threadId });
  void t;
  return { workId, rid, threadId, view, events };
}

describe("Convex 統合: コメント・返信へのリアクション", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("コメントに付け外しでき、一覧には閲覧者ごとの集計（人数・自分・付けた人の名前）が載る", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { threadId, view } = await setup(t, cast);

    await cast.creator.as.mutation(api.comments.toggleReaction, { threadId, emoji: "👍" });
    await cast.reviewer.as.mutation(api.comments.toggleReaction, { threadId, emoji: "👍" });
    await cast.reviewer.as.mutation(api.comments.toggleReaction, { threadId, emoji: "🎉" });

    const asCreator = (await view(cast.creator)).threads[0]!;
    expect(asCreator.reactions.map((r) => [r.emoji, r.count, r.mine])).toEqual([
      ["👍", 2, true],
      ["🎉", 1, false],
    ]);
    expect(asCreator.reactions[0]!.users.map((u) => u.id)).toEqual([
      cast.creator.id,
      cast.reviewer.id,
    ]);
    expect(asCreator.reactions[0]!.users.every((u) => u.name.length > 0)).toBe(true);
    const asManager = (await view(cast.manager)).threads[0]!;
    expect(asManager.reactions.map((r) => r.mine)).toEqual([false, false]);

    // もう一度押すと外れ、誰も付けていない絵文字は消える
    await cast.creator.as.mutation(api.comments.toggleReaction, { threadId, emoji: "👍" });
    await cast.reviewer.as.mutation(api.comments.toggleReaction, { threadId, emoji: "🎉" });
    const after = (await view(cast.creator)).threads[0]!;
    expect(after.reactions.map((r) => [r.emoji, r.count, r.mine])).toEqual([["👍", 1, false]]);
  });

  it("返信にも付け外しでき、履歴（events）に載る。コメントのリアクションとは別", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { threadId, view, events } = await setup(t, cast);
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "対応します" });
    const [reply] = (await events(cast.reviewer)).events.filter((e) => e.eventType === "replied");

    await cast.reviewer.as.mutation(api.comments.toggleReaction, {
      threadId,
      replyEventId: reply!.id,
      emoji: "🙏",
    });
    await cast.approver.as.mutation(api.comments.toggleReaction, {
      threadId,
      replyEventId: reply!.id,
      emoji: "🙏",
    });
    const seen = (await events(cast.reviewer)).events.find((e) => e.id === reply!.id)!;
    expect(seen.reactions.map((r) => [r.emoji, r.count, r.mine])).toEqual([["🙏", 2, true]]);
    expect((await view(cast.reviewer)).threads[0]!.reactions).toEqual([]);

    // 付けた人は取り消せる。削除した返信には付けられない
    await cast.reviewer.as.mutation(api.comments.toggleReaction, {
      threadId,
      replyEventId: reply!.id,
      emoji: "🙏",
    });
    expect(
      (await events(cast.reviewer)).events.find((e) => e.id === reply!.id)!.reactions[0],
    ).toMatchObject({ count: 1, mine: false });
    await cast.creator.as.mutation(api.comments.removeReply, { threadId, replyEventId: reply!.id });
    await expect(
      cast.reviewer.as.mutation(api.comments.toggleReaction, {
        threadId,
        replyEventId: reply!.id,
        emoji: "👍",
      }),
    ).rejects.toThrow(code("comment_reply_not_found"));
  });

  it("見られない人・決まった絵文字以外・削除されたコメントは拒否する", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { threadId } = await setup(t, cast, "restricted");
    await expect(
      cast.stranger.as.mutation(api.comments.toggleReaction, { threadId, emoji: "👍" }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      cast.reviewer.as.mutation(api.comments.toggleReaction, { threadId, emoji: "😀" }),
    ).rejects.toThrow(code("comment_reaction_invalid"));
    await cast.reviewer.as.mutation(api.comments.remove, { threadId });
    await expect(
      cast.creator.as.mutation(api.comments.toggleReaction, { threadId, emoji: "👍" }),
    ).rejects.toThrow(code("comment_thread_deleted"));
  });
});
