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
    confidentiality: "normal",
  })) as Id<"works">;
  await cast.admin.as.mutation(api.acl.grant, {
    workId,
    principalType: "user",
    principalId: cast.reviewer.id,
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
    expect(before.threads[0]).toMatchObject({ deleted: false, can: { delete: true } });
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
    // 自分の担当一覧の件数からも外れる
    const queue = await cast.reviewer.as.query(api.reviews.myQueue, {});
    expect(queue.every((q) => q.totalCommentCount === 0 && q.myCommentCount === 0)).toBe(true);
    // 履歴（原文）は残る: 管理用の履歴は events の記録で確かめず、削除済みの履歴は返さない
    const events = await cast.creator.as.query(api.comments.events, { threadId });
    expect(events.events).toEqual([]);
  });

  it("他の人の返信があるスレッドは一覧に残り、本文・位置は伏せられ、操作はできない。返信を全て消すと一覧から外れる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { rid, postAs, view } = await setup(t, cast);
    const threadId = await postAs(cast.reviewer);
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "対応します" });

    await cast.reviewer.as.mutation(api.comments.remove, { threadId });
    const after = await view();
    expect(after.threads).toHaveLength(1);
    const th = after.threads[0]!;
    expect(th).toMatchObject({ id: threadId, deleted: true, can: { delete: false } });
    expect(th.body).not.toBe("団体名が誤り");
    expect(th.anchor).toBeUndefined();

    // 返信は見える。削除済みのスレッドには返信・採否ができない
    const ev = await cast.creator.as.query(api.comments.events, { threadId });
    expect(ev.canDecide).toBe(false);
    const replies = ev.events.filter((e) => e.eventType === "replied");
    expect(replies).toHaveLength(1);
    expect(replies[0]!.can).toEqual({ delete: true });
    await expect(
      cast.creator.as.mutation(api.comments.reply, { threadId, body: "y" }),
    ).rejects.toThrow(code("comment_thread_deleted"));
    await expect(
      cast.creator.as.mutation(api.comments.decide, { threadId, action: "accepted" }),
    ).rejects.toThrow(code("comment_thread_deleted"));

    await cast.creator.as.mutation(api.comments.removeReply, {
      threadId,
      replyEventId: replies[0]!.id,
    });
    expect(
      (await cast.creator.as.query(api.revisions.get, { revisionId: rid })).threads,
    ).toHaveLength(0);
  });

  it("返信の削除は返信した本人だけ。削除した返信は本文を伏せて残り、スレッドは生きたまま", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { postAs, view } = await setup(t, cast);
    const threadId = await postAs(cast.reviewer);
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "対応します" });
    const events = () => cast.reviewer.as.query(api.comments.events, { threadId });
    const [reply] = (await events()).events.filter((e) => e.eventType === "replied");
    expect(reply!.can).toEqual({ delete: false }); // 見ているのは校正者

    for (const who of [cast.reviewer, cast.manager]) {
      await expect(
        who.as.mutation(api.comments.removeReply, { threadId, replyEventId: reply!.id }),
      ).rejects.toThrow(code("comment_delete_not_author"));
    }
    await cast.creator.as.mutation(api.comments.removeReply, { threadId, replyEventId: reply!.id });
    const [after] = (await events()).events.filter((e) => e.eventType === "replied");
    expect(after).toMatchObject({ id: reply!.id, deleted: true });
    expect((after!.payload as { body: string }).body).not.toBe("対応します");
    expect((await view()).threads[0]).toMatchObject({ deleted: false });
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
    expect(reply!.can).toEqual({ delete: true });

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
});
