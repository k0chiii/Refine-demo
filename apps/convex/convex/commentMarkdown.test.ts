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
  return { rid: revisionId as Id<"revisions"> };
}

describe("Convex 統合: コメント本文の書式（markdown。書式なしは旧来の平文）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("投稿・返信・訂正が書式を保存し、一覧と履歴に載る。書式なしの行はそのまま読める", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { rid } = await setup(cast);
    const mdId = (await cast.reviewer.as.mutation(api.comments.post, {
      revisionId: rid,
      body: "**団体名**が誤り https://example.com",
      bodyFormat: "markdown",
      kind: "correction",
      severity: "info",
    })) as Id<"commentThreads">;
    const legacyId = (await cast.reviewer.as.mutation(api.comments.post, {
      revisionId: rid,
      body: "旧来の本文 **そのまま**",
      kind: "correction",
      severity: "info",
    })) as Id<"commentThreads">;
    // 書式の項目が無い保存済みの行（この機能より前に作られたもの）と同じ形
    const raw = await t.run((ctx) => ctx.db.get("commentThreads", legacyId));
    expect(raw).not.toHaveProperty("bodyFormat");

    await cast.creator.as.mutation(api.comments.reply, {
      threadId: mdId,
      body: "- 直します",
      bodyFormat: "markdown",
    });
    await cast.creator.as.mutation(api.comments.reply, { threadId: mdId, body: "平文の返信" });
    await cast.reviewer.as.mutation(api.comments.edit, {
      threadId: legacyId,
      body: "> 訂正しました",
      bodyFormat: "markdown",
    });

    const view = await cast.creator.as.query(api.revisions.get, { revisionId: rid });
    const byId = new Map(view.threads.map((th) => [th.id, th]));
    expect(byId.get(mdId)).toMatchObject({ bodyFormat: "markdown" });
    expect(byId.get(legacyId)).toMatchObject({ body: "> 訂正しました", bodyFormat: "markdown" });

    const replies = (
      await cast.creator.as.query(api.comments.events, { threadId: mdId })
    ).events.filter((e) => e.eventType === "replied");
    expect(replies.map((e) => (e.payload as { bodyFormat?: string }).bodyFormat)).toEqual([
      "markdown",
      undefined,
    ]);
    const edited = (
      await cast.creator.as.query(api.comments.events, { threadId: legacyId })
    ).events.find((e) => e.eventType === "edited");
    expect(edited?.payload).toEqual({
      previousBody: "旧来の本文 **そのまま**",
      bodyFormat: "markdown",
    });
  });

  it("知らない書式・長すぎる本文は拒否する", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { rid } = await setup(cast);
    const base = { revisionId: rid, kind: "correction", severity: "info" } as const;
    await expect(
      cast.reviewer.as.mutation(api.comments.post, { ...base, body: "x", bodyFormat: "html" }),
    ).rejects.toThrow(code("comment_body_format_invalid"));
    await expect(
      cast.reviewer.as.mutation(api.comments.post, { ...base, body: "あ".repeat(5001) }),
    ).rejects.toThrow(code("comment_body_too_long"));
  });
});
