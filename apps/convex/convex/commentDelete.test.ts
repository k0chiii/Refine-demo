import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness, HOUR, uploadVerified, type Harness } from "../test/harness";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

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
  const postAs = (who: Cast["reviewer"], severity: "critical" | "info" = "critical") =>
    who.as.mutation(api.comments.post, {
      revisionId: rid,
      body: "団体名が誤り",
      kind: "correction",
      severity,
    }) as Promise<Id<"commentThreads">>;
  const view = () => cast.reviewer.as.query(api.revisions.get, { revisionId: rid });
  return { t, workId, rid, postAs, view };
}

describe("Convex 統合: コメントの削除（投稿者・システム管理者）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("投稿者だけが削除でき、サーバーが can.delete を返す。返信が無ければ一覧・件数から消え、履歴は残る", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { rid, postAs, view } = await setup(t, cast);
    const threadId = await postAs(cast.reviewer);

    const before = await view();
    expect(before.threads).toHaveLength(1);
    expect(before.threads[0]).toMatchObject({ can: { delete: true } });
    // 他の人から見ると削除できない
    const asCreator = await cast.creator.as.query(api.revisions.get, { revisionId: rid });
    expect(asCreator.threads[0]?.can.delete).toBe(false);

    for (const who of [cast.creator, cast.manager, cast.approver]) {
      await expect(who.as.mutation(api.comments.remove, { threadId })).rejects.toThrow(
        code("comment_delete_not_author"),
      );
    }
    expect((await view()).threads).toHaveLength(1);

    await cast.reviewer.as.mutation(api.comments.remove, { threadId });
    expect((await view()).threads).toHaveLength(0);
    // 履歴（原文）は残る: 管理用の履歴は events の記録で確かめず、削除済みの履歴は返さない
    const events = await cast.creator.as.query(api.comments.events, { threadId });
    expect(events.events).toEqual([]);
  });

  it("他の人の返信があっても、投稿者の削除で返信ごと消える。「削除されたコメント」は残らず、操作もできない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { rid, postAs, view } = await setup(t, cast);
    const threadId = await postAs(cast.reviewer);
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "対応します" });

    await cast.reviewer.as.mutation(api.comments.remove, { threadId });
    expect((await view()).threads).toHaveLength(0);
    expect(
      (await cast.creator.as.query(api.revisions.get, { revisionId: rid })).threads,
    ).toHaveLength(0);
    // 履歴は返さない。返信・採否はできない
    const ev = await cast.creator.as.query(api.comments.events, { threadId });
    expect(ev.events).toEqual([]);
    expect(ev.canDecide).toBe(false);
    await expect(
      cast.creator.as.mutation(api.comments.reply, { threadId, body: "y" }),
    ).rejects.toThrow(code("comment_thread_deleted"));
    await expect(
      cast.creator.as.mutation(api.comments.decide, { threadId, action: "accepted" }),
    ).rejects.toThrow(code("comment_thread_deleted"));
    // 返信は削除済み（原文は履歴に残る）
    const stored = await t.run((ctx) =>
      ctx.db
        .query("commentEvents")
        .filter((q) => q.eq(q.field("threadId"), threadId))
        .collect(),
    );
    expect(stored.filter((e) => e.eventType === "reply_deleted")).toHaveLength(1);
    expect(stored.filter((e) => e.eventType === "replied")).toHaveLength(1);
  });

  it("古い仕様で「削除されたコメント」として残っていた行（deletedKeepsReplies）も一覧に出ない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { rid, postAs, view } = await setup(t, cast);
    const threadId = await postAs(cast.reviewer);
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "対応します" });
    await t.run((ctx) =>
      ctx.db.patch(threadId, { deletedAt: Date.now(), deletedKeepsReplies: true }),
    );
    expect((await view()).threads).toHaveLength(0);
    expect(
      (await cast.creator.as.query(api.revisions.get, { revisionId: rid })).threads,
    ).toHaveLength(0);
    expect((await cast.creator.as.query(api.comments.events, { threadId })).events).toEqual([]);
  });

  it("返信の削除は返信した本人だけ。削除した返信は履歴に並ばず、スレッドは生きたまま", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { postAs, view } = await setup(t, cast);
    const threadId = await postAs(cast.reviewer);
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "対応します" });
    const events = () => cast.reviewer.as.query(api.comments.events, { threadId });
    const [reply] = (await events()).events.filter((e) => e.eventType === "replied");
    expect(reply!.can).toEqual({ delete: false, edit: false });

    for (const who of [cast.reviewer, cast.manager]) {
      await expect(
        who.as.mutation(api.comments.removeReply, { threadId, replyEventId: reply!.id }),
      ).rejects.toThrow(code("comment_delete_not_author"));
    }
    await cast.creator.as.mutation(api.comments.removeReply, { threadId, replyEventId: reply!.id });
    expect((await events()).events.filter((e) => e.eventType === "replied")).toEqual([]);
    expect((await view()).threads).toHaveLength(1);
    await expect(
      cast.creator.as.mutation(api.comments.removeReply, { threadId, replyEventId: reply!.id }),
    ).rejects.toThrow(code("comment_reply_not_found"));
  });

  it("削除した重大指摘は校了をブロックしない。校了後は投稿者でも削除できない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { workId, rid, postAs } = await setup(t, cast);
    const blocking = await postAs(cast.reviewer, "critical");
    await expect(
      cast.approver.as.mutation(api.approvals.finalize, { workId, revisionId: rid }),
    ).rejects.toThrow(code("approval_blocking_threads_remain"));
    await cast.reviewer.as.mutation(api.comments.remove, { threadId: blocking });

    const kept = await postAs(cast.reviewer, "info");
    await cast.approver.as.mutation(api.approvals.finalize, { workId, revisionId: rid });
    await expect(
      cast.reviewer.as.mutation(api.comments.remove, { threadId: kept }),
    ).rejects.toThrow(code("work_already_finalized"));
    const v = await cast.reviewer.as.query(api.revisions.get, { revisionId: rid });
    expect(v.threads[0]?.can.delete).toBe(false);
  });

  it("システム管理者は他人のコメント・返信を校了後も削除でき、サーバーが can.delete を返す。監査に残る", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { workId, rid, postAs } = await setup(t, cast);
    const first = await postAs(cast.reviewer, "info");
    const second = await postAs(cast.reviewer, "info");
    await cast.creator.as.mutation(api.comments.reply, { threadId: first, body: "対応します" });
    const asAdmin = () => cast.admin.as.query(api.revisions.get, { revisionId: rid });
    expect((await asAdmin()).threads.map((x) => x.can.delete)).toEqual([true, true]);
    // 管理者以外の他人は不可のまま
    expect(
      (await cast.manager.as.query(api.revisions.get, { revisionId: rid })).threads[0],
    ).toMatchObject({
      can: { delete: false },
    });
    const [reply] = (
      await cast.admin.as.query(api.comments.events, { threadId: first })
    ).events.filter((e) => e.eventType === "replied");
    expect(reply!.can).toEqual({ delete: true, edit: false });

    await cast.admin.as.mutation(api.comments.removeReply, {
      threadId: first,
      replyEventId: reply!.id,
    });
    await cast.approver.as.mutation(api.approvals.finalize, { workId, revisionId: rid });
    // 校了後: 投稿者は消せないが、管理者は消せる
    await expect(
      cast.reviewer.as.mutation(api.comments.remove, { threadId: second }),
    ).rejects.toThrow(code("work_already_finalized"));
    expect((await asAdmin()).threads.map((x) => x.can.delete)).toEqual([true, true]);
    await cast.admin.as.mutation(api.comments.remove, { threadId: second });
    await cast.admin.as.mutation(api.comments.remove, { threadId: first });
    expect((await asAdmin()).threads).toHaveLength(0);

    const audits = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    const mine = audits.filter(
      (a) => a.operation === "delete" && ["commentThread", "commentReply"].includes(a.entityType),
    );
    expect(mine.map((a) => a.entityType).sort()).toEqual([
      "commentReply",
      "commentThread",
      "commentThread",
    ]);
    expect(mine.every((a) => a.actorId === cast.admin.id)).toBe(true);
    expect(mine.find((a) => a.entityType === "commentReply")?.before).toMatchObject({
      authorId: cast.creator.id,
    });
    expect(
      mine
        .filter((a) => a.entityType === "commentThread")
        .every((a) => (a.before as { authorId: string }).authorId === cast.reviewer.id),
    ).toBe(true);
  });

  it("管理者が返信付きのコメントを削除すると、返信ごと一覧・件数・通知から消え、監査は 1 件。本人の削除も返信ごと消える（監査は出ない）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { rid, postAs } = await setup(t, cast);
    const threadId = await postAs(cast.reviewer, "critical");
    const own = await postAs(cast.reviewer, "info");
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "対応します" });
    await cast.reviewer.as.mutation(api.comments.reply, { threadId, body: "お願いします" });
    await cast.creator.as.mutation(api.comments.reply, { threadId: own, body: "了解" });

    // 削除できるのは管理者と本人だけ。削除は常に返信ごと
    const flags = async (who: Cast["admin"]) =>
      (await who.as.query(api.revisions.get, { revisionId: rid })).threads.map((x) => x.can);
    expect(await flags(cast.admin)).toEqual([
      { delete: true, edit: false },
      { delete: true, edit: false },
    ]);
    expect(await flags(cast.reviewer)).toEqual([
      { delete: true, edit: true },
      { delete: true, edit: true },
    ]);
    expect(await flags(cast.creator)).toEqual([
      { delete: false, edit: false },
      { delete: false, edit: false },
    ]);

    await cast.admin.as.mutation(api.comments.remove, { threadId });
    const after = await cast.creator.as.query(api.revisions.get, { revisionId: rid });
    expect(after.threads.map((x) => x.id)).toEqual([own]); // 「削除されたコメント」も残らない
    expect((await cast.creator.as.query(api.comments.events, { threadId })).events).toEqual([]);
    // 返信を 1 件ずつ消す必要はない（消えているので見つからない）
    const events = await t.run((ctx) =>
      ctx.db
        .query("commentEvents")
        .filter((q) => q.eq(q.field("threadId"), threadId))
        .collect(),
    );
    expect(events.filter((e) => e.eventType === "reply_deleted")).toHaveLength(2);
    // 削除したコメントへの通知は飛び先を返さない
    const notes = await cast.creator.as.query(api.notifications.list, {});
    expect(notes.some((n) => n.threadId === threadId)).toBe(false);

    // 本人の削除も返信ごと消える（他の人の返信のために残さない）
    await cast.reviewer.as.mutation(api.comments.remove, { threadId: own });
    expect(
      (await cast.creator.as.query(api.revisions.get, { revisionId: rid })).threads,
    ).toHaveLength(0);

    const audits = await t.run((ctx) => ctx.db.query("auditEvents").collect());
    const mine = audits.filter((a) => a.operation === "delete" && a.entityType === "commentThread");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      actorId: cast.admin.id,
      before: { authorId: cast.reviewer.id },
      after: { byAdmin: true, repliesDeleted: 2, afterFinalized: false },
    });
  });
});
