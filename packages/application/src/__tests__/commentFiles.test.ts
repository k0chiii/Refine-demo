import { setWorkReviewers } from "../usecases/reviewers.ts";
import { COMMENT_FILE_TTL_MS, COMMENT_THUMB_MAX_BYTES, type Principal } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import {
  COMMENT_ORPHAN_PREFIX,
  authorizeCommentFile,
  beginCommentFileUpload,
  beginCommentThumbUpload,
  completeCommentFileUpload,
  completeCommentThumbUpload,
  expireCommentFiles,
  failCommentFileUpload,
  listCommentFileViews,
  listOrphanCommentObjects,
  markCommentObjectsPurged,
  prepareCommentFiles,
  replyFileIds,
} from "../usecases/commentFiles.ts";
import { deleteReply, deleteThread, postComment, replyToThread } from "../usecases/comments.ts";
import { listMyNotifications } from "../usecases/notifications.ts";
import { createInMemoryContext, type InMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const { creator, reviewer, stranger, sysadmin, manager } = principals;

async function setup(over: { confidentiality?: "normal" | "restricted" } = {}) {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx, over);
  const revision = await submitRevision(ctx, work.id, { deadlineInHours: 24 });
  await grantWorkPermission(ctx, sysadmin, {
    workId: work.id,
    userIds: [reviewer.userId],
    permission: "review",
  });
  await setWorkReviewers(ctx, manager, {
    workId: revision.workId,
    reviewerIds: [reviewer.userId],
  });
  return { ctx, work, revision };
}

const imageDecl = (over: Record<string, unknown> = {}) => ({
  fileName: "photo.webp",
  originalName: "IMG_0001.png",
  mimeType: "image/webp",
  size: 100,
  originalSize: 900,
  width: 1280,
  height: 720,
  ...over,
});

/** 準備 → Hono が実体を検証して記録するのと同じ手順（試行の開始 → 検証完了）。画像ならサムネイルも */
async function uploadFile(
  ctx: InMemoryContext,
  by: Principal,
  revisionId: string,
  opts: { purpose?: "comment" | "reply"; thumb?: boolean; decl?: Record<string, unknown> } = {},
) {
  const decl = imageDecl(opts.decl);
  const [prepared] = await prepareCommentFiles(ctx, by, {
    revisionId,
    purpose: opts.purpose ?? "comment",
    files: [decl as never],
  });
  const fileId = prepared!.fileId;
  const { attemptId } = await beginCommentFileUpload(ctx, by, { fileId });
  await completeCommentFileUpload(ctx, by, {
    attemptId,
    size: decl.size as number,
    sha256: "a".repeat(64),
  });
  if (opts.thumb) {
    await beginCommentThumbUpload(ctx, by, { fileId });
    await completeCommentThumbUpload(ctx, by, { fileId, size: 40, mimeType: "image/webp" });
  }
  return fileId;
}

describe("コメントの添付: 準備（投稿と同じ条件）", () => {
  it("受付中の版には校正者が準備でき、キーは comments/ の下に予約される", async () => {
    const { ctx, work, revision } = await setup();
    const [a, b] = await prepareCommentFiles(ctx, reviewer, {
      revisionId: revision.id,
      purpose: "comment",
      files: [imageDecl(), { fileName: "仕様.pdf", mimeType: "application/pdf", size: 5 }],
    });
    const fa = (await ctx.commentFiles.findFile(a!.fileId))!;
    expect(fa).toMatchObject({
      workId: work.id,
      revisionId: revision.id,
      uploaderId: reviewer.userId,
      status: "pending",
      type: "image",
      width: 1280,
      height: 720,
      originalName: "IMG_0001.png",
      originalSize: 900,
    });
    expect(fa.keyPrefix).toBe(`comments/${work.id}/${a!.fileId}/photo.webp`);
    expect((await ctx.commentFiles.findFile(b!.fileId))!.type).toBe("pdf");
  });
  it("見えない人（restricted の制作物の関係者でない人）は準備できない", async () => {
    const { ctx, revision } = await setup({ confidentiality: "restricted" });
    await expect(
      prepareCommentFiles(ctx, stranger, {
        revisionId: revision.id,
        purpose: "comment",
        files: [imageDecl()],
      }),
    ).rejects.toThrow(code("forbidden"));
  });
  it("0 件・11 件・大きすぎるファイルは断る（何も予約しない）", async () => {
    const { ctx, revision } = await setup();
    const prepare = (files: unknown[]) =>
      prepareCommentFiles(ctx, reviewer, {
        revisionId: revision.id,
        purpose: "comment",
        files: files as never,
      });
    await expect(prepare([])).rejects.toThrow(code("comment_file_invalid"));
    await expect(prepare(Array.from({ length: 11 }, () => imageDecl()))).rejects.toThrow(
      code("comment_file_invalid"),
    );
    await expect(prepare([imageDecl(), imageDecl({ size: 100_000_001 })])).rejects.toThrow(
      code("upload_file_too_large"),
    );
    expect(ctx.state.commentFiles.all()).toHaveLength(0);
  });
  it("コメントは締切後は準備できないが、返信用は準備できる。校了後はどちらも不可", async () => {
    const { ctx, work, revision } = await setup();
    ctx.clock.advance(25 * HOUR);
    const base = { revisionId: revision.id, files: [imageDecl()] };
    await expect(
      prepareCommentFiles(ctx, reviewer, { ...base, purpose: "comment" }),
    ).rejects.toThrow();
    await expect(
      prepareCommentFiles(ctx, reviewer, { ...base, purpose: "reply" }),
    ).resolves.toHaveLength(1);
    await ctx.works.update({ ...work, lifecycle: "finalized" });
    await expect(prepareCommentFiles(ctx, reviewer, { ...base, purpose: "reply" })).rejects.toThrow(
      code("work_already_finalized"),
    );
  });
});

describe("コメントの添付: 実体の転送", () => {
  it("検証が済むと verified になり、試行のキーを採用する。本人以外・検証後は転送できない", async () => {
    const { ctx, revision } = await setup();
    const fileId = await uploadFile(ctx, reviewer, revision.id);
    const f = (await ctx.commentFiles.findFile(fileId))!;
    expect(f).toMatchObject({ status: "verified", size: 100, sha256: "a".repeat(64) });
    expect(f.objectKey).toMatch(/\/attempts\//);
    await expect(beginCommentFileUpload(ctx, reviewer, { fileId })).rejects.toThrow(
      code("comment_file_invalid"),
    );
    const [other] = await prepareCommentFiles(ctx, reviewer, {
      revisionId: revision.id,
      purpose: "comment",
      files: [imageDecl()],
    });
    await expect(beginCommentFileUpload(ctx, creator, { fileId: other!.fileId })).rejects.toThrow(
      code("comment_file_not_found"),
    );
  });
  it("申告サイズと違えば failed。失敗の補償は検証済みの添付には効かない", async () => {
    const { ctx, revision } = await setup();
    const [p] = await prepareCommentFiles(ctx, reviewer, {
      revisionId: revision.id,
      purpose: "comment",
      files: [imageDecl()],
    });
    const { attemptId } = await beginCommentFileUpload(ctx, reviewer, { fileId: p!.fileId });
    const r = await completeCommentFileUpload(ctx, reviewer, {
      attemptId,
      size: 99,
      sha256: "b".repeat(64),
    });
    expect(r.status).toBe("failed");
    // 失敗した添付は、同じ試行で採用し直せない
    await expect(
      completeCommentFileUpload(ctx, reviewer, { attemptId, size: 100, sha256: "b".repeat(64) }),
    ).rejects.toThrow();
    const ok = await uploadFile(ctx, reviewer, revision.id);
    const verifiedAttempt = ctx.state.attempts
      .all()
      .find((a) => a.target === "commentFile" && a.targetId === ok)!;
    await failCommentFileUpload(ctx, reviewer, {
      attemptId: verifiedAttempt.id,
      message: "遅れた補償",
    });
    expect((await ctx.commentFiles.findFile(ok))!.status).toBe("verified");
  });
  it("サムネイルは付ける前の画像の添付に、webp / jpeg の 512 KB 以内で置ける", async () => {
    const { ctx, revision } = await setup();
    const fileId = await uploadFile(ctx, reviewer, revision.id);
    const { objectKey } = await beginCommentThumbUpload(ctx, reviewer, { fileId });
    expect(objectKey).toMatch(/^comments\/.+\/photo\.webp\/thumb$/);
    await expect(
      completeCommentThumbUpload(ctx, reviewer, { fileId, size: 10, mimeType: "image/png" }),
    ).rejects.toThrow(code("comment_file_invalid"));
    await expect(
      completeCommentThumbUpload(ctx, reviewer, {
        fileId,
        size: COMMENT_THUMB_MAX_BYTES + 1,
        mimeType: "image/webp",
      }),
    ).rejects.toThrow(code("comment_file_invalid"));
    await completeCommentThumbUpload(ctx, reviewer, { fileId, size: 77, mimeType: "image/webp" });
    expect(await ctx.commentFiles.findFile(fileId)).toMatchObject({
      thumbObjectKey: objectKey,
      thumbSize: 77,
      thumbMime: "image/webp",
    });
    // 他人・画像でない添付には置けない
    await expect(beginCommentThumbUpload(ctx, creator, { fileId })).rejects.toThrow(
      code("comment_file_not_found"),
    );
    const [pdf] = await prepareCommentFiles(ctx, reviewer, {
      revisionId: revision.id,
      purpose: "comment",
      files: [{ fileName: "a.pdf", mimeType: "application/pdf", size: 1 }],
    });
    await expect(beginCommentThumbUpload(ctx, reviewer, { fileId: pdf!.fileId })).rejects.toThrow(
      code("comment_file_invalid"),
    );
  });
  it("コメントに付けた後は、サムネイルも置き換えられない", async () => {
    const { ctx, revision } = await setup();
    const fileId = await uploadFile(ctx, reviewer, revision.id, { thumb: true });
    await postComment(ctx, reviewer, {
      revisionId: revision.id,
      body: "見て",
      kind: "discussion",
      severity: "info",
      fileIds: [fileId],
    });
    await expect(beginCommentThumbUpload(ctx, reviewer, { fileId })).rejects.toThrow(
      code("comment_file_invalid"),
    );
  });
});

describe("コメントの添付: コメント・返信に付ける", () => {
  it("コメントに付けると threadId が入り、スレッドの fileIds と画面の要約に載る。本文が空でも可", async () => {
    const { ctx, revision } = await setup();
    const f1 = await uploadFile(ctx, reviewer, revision.id, { thumb: true });
    const f2 = await uploadFile(ctx, reviewer, revision.id, {
      decl: {
        fileName: "仕様.pdf",
        mimeType: "application/pdf",
        width: undefined,
        height: undefined,
      },
    });
    const thread = await postComment(ctx, reviewer, {
      revisionId: revision.id,
      body: "",
      kind: "discussion",
      severity: "info",
      fileIds: [f1, f2, f1],
    });
    expect(thread.fileIds).toEqual([f1, f2]);
    expect(thread.body).toBe("");
    expect((await ctx.commentFiles.findFile(f1))!.threadId).toBe(thread.id);
    expect(await listCommentFileViews(ctx, thread.fileIds)).toEqual([
      {
        id: f1,
        name: "photo.webp",
        mime: "image/webp",
        size: 100,
        type: "image",
        width: 1280,
        height: 720,
        hasThumb: true,
      },
      expect.objectContaining({ id: f2, type: "pdf", hasThumb: false }),
    ]);
    // 本文のない添付だけのコメントでも、制作者への通知には添付があることが載る
    const [n] = await listMyNotifications(ctx, creator);
    expect(n!.body).toContain("添付");
  });
  it("本文も添付も無ければ投稿できない", async () => {
    const { ctx, revision } = await setup();
    await expect(
      postComment(ctx, reviewer, {
        revisionId: revision.id,
        body: " ",
        kind: "discussion",
        severity: "info",
      }),
    ).rejects.toThrow(code("forbidden"));
  });
  it("付けられない添付が 1 つでもあれば、コメントごと投稿されない", async () => {
    const { ctx, revision } = await setup();
    const mine = await uploadFile(ctx, reviewer, revision.id);
    const theirs = await uploadFile(ctx, manager, revision.id);
    const [pending] = await prepareCommentFiles(ctx, reviewer, {
      revisionId: revision.id,
      purpose: "comment",
      files: [imageDecl()],
    });
    const post = (fileIds: string[]) =>
      postComment(ctx, reviewer, {
        revisionId: revision.id,
        body: "x",
        kind: "discussion",
        severity: "info",
        fileIds,
      });
    await expect(post([mine, theirs])).rejects.toThrow(code("comment_file_not_ready"));
    await expect(post([mine, pending!.fileId])).rejects.toThrow(code("comment_file_not_ready"));
    await expect(post([mine, "nope"])).rejects.toThrow(code("comment_file_not_ready"));
    await expect(post(Array.from({ length: 11 }, (_, i) => `f${i}`))).rejects.toThrow(
      code("comment_file_invalid"),
    );
    // どれも付いていない
    expect((await ctx.commentFiles.findFile(mine))!.threadId).toBeUndefined();
    const t = await post([mine]);
    // 付いた添付は別のコメントに付け替えられない
    await expect(post([mine])).rejects.toThrow(code("comment_file_not_ready"));
    expect(t.fileIds).toEqual([mine]);
  });
  it("同じ requestId の再送は添付を二重に付けず、同じスレッドを返す", async () => {
    const { ctx, revision } = await setup();
    const f = await uploadFile(ctx, reviewer, revision.id);
    const input = {
      revisionId: revision.id,
      body: "x",
      kind: "discussion" as const,
      severity: "info" as const,
      fileIds: [f],
      requestId: "req-1",
    };
    const a = await postComment(ctx, reviewer, input);
    const b = await postComment(ctx, reviewer, input);
    expect(b.id).toBe(a.id);
  });
  it("返信にも付けられ、返信のイベントと添付が対応する。締切後の返信でも可", async () => {
    const { ctx, revision } = await setup();
    const thread = await postComment(ctx, reviewer, {
      revisionId: revision.id,
      body: "ここ",
      kind: "question",
      severity: "minor",
    });
    ctx.clock.advance(25 * HOUR);
    const f = await uploadFile(ctx, creator, revision.id, { purpose: "reply", thumb: true });
    await replyToThread(ctx, creator, { threadId: thread.id, body: "", fileIds: [f] });
    const reply = (await ctx.threads.listEvents(thread.id)).find((e) => e.eventType === "replied")!;
    expect(replyFileIds(reply.payload)).toEqual([f]);
    expect(await ctx.commentFiles.findFile(f)).toMatchObject({
      threadId: thread.id,
      eventId: reply.id,
    });
    // 返信の添付は本人が上げたものだけ
    const other = await uploadFile(ctx, reviewer, revision.id, { purpose: "reply" });
    await expect(
      replyToThread(ctx, creator, { threadId: thread.id, body: "x", fileIds: [other] }),
    ).rejects.toThrow(code("comment_file_not_ready"));
    await expect(replyToThread(ctx, creator, { threadId: thread.id, body: "" })).rejects.toThrow(
      code("forbidden"),
    );
  });
});

describe("コメントの添付: 読み取りの認可", () => {
  it("付ける前は上げた本人だけ。付いた後は制作物を見られる人なら誰でも（原本もサムネイルも）", async () => {
    const { ctx, revision } = await setup();
    const f = await uploadFile(ctx, reviewer, revision.id, { thumb: true });
    const read = (by: Principal, variant: "original" | "thumb" = "original") =>
      authorizeCommentFile(ctx, by, { fileId: f, variant });
    expect(await read(reviewer)).toMatchObject({ mimeType: "image/webp", size: 100 });
    await expect(read(creator)).rejects.toThrow(code("forbidden"));
    await postComment(ctx, reviewer, {
      revisionId: revision.id,
      body: "x",
      kind: "discussion",
      severity: "info",
      fileIds: [f],
    });
    const original = await read(creator);
    expect(original).toMatchObject({ fileName: "photo.webp", cacheable: false });
    expect(original.objectKey).toMatch(/\/attempts\//);
    const thumb = await read(stranger, "thumb");
    expect(thumb).toMatchObject({ mimeType: "image/webp", size: 40, cacheable: true });
    expect(thumb.objectKey).toMatch(/\/thumb$/);
  });
  it("サムネイルが無い添付のサムネイルは not_ready", async () => {
    const { ctx, revision } = await setup();
    const f = await uploadFile(ctx, reviewer, revision.id);
    await expect(
      authorizeCommentFile(ctx, reviewer, { fileId: f, variant: "thumb" }),
    ).rejects.toThrow(code("comment_file_not_ready"));
  });
  it("restricted の制作物は、見られない人には読めず、サムネイルも端末に残させない", async () => {
    const { ctx, revision } = await setup({ confidentiality: "restricted" });
    const f = await uploadFile(ctx, reviewer, revision.id, { thumb: true });
    await postComment(ctx, reviewer, {
      revisionId: revision.id,
      body: "x",
      kind: "discussion",
      severity: "info",
      fileIds: [f],
    });
    await expect(
      authorizeCommentFile(ctx, stranger, { fileId: f, variant: "original" }),
    ).rejects.toThrow(code("forbidden"));
    expect(await authorizeCommentFile(ctx, creator, { fileId: f, variant: "thumb" })).toMatchObject(
      { cacheable: false },
    );
  });
  it("存在しない添付は forbidden（存在を漏らさない）", async () => {
    const { ctx } = await setup();
    await expect(
      authorizeCommentFile(ctx, reviewer, { fileId: "nope", variant: "original" }),
    ).rejects.toThrow(code("forbidden"));
  });
});

describe("コメントの添付: 削除と清掃", () => {
  async function postedWithReply() {
    const s = await setup();
    const { ctx, revision } = s;
    const fThread = await uploadFile(ctx, reviewer, revision.id, { thumb: true });
    const thread = await postComment(ctx, reviewer, {
      revisionId: revision.id,
      body: "x",
      kind: "discussion",
      severity: "info",
      fileIds: [fThread],
    });
    const fReply = await uploadFile(ctx, creator, revision.id, { purpose: "reply", thumb: true });
    await replyToThread(ctx, creator, { threadId: thread.id, body: "r", fileIds: [fReply] });
    const replyId = (await ctx.threads.listEvents(thread.id)).find(
      (e) => e.eventType === "replied",
    )!.id!;
    return { ...s, thread, fThread, fReply, replyId };
  }

  it("返信を削除すると、その返信の添付だけ読めなくなる", async () => {
    const { ctx, thread, fThread, fReply, replyId } = await postedWithReply();
    await deleteReply(ctx, creator, { threadId: thread.id, replyEventId: replyId });
    await expect(
      authorizeCommentFile(ctx, reviewer, { fileId: fReply, variant: "original" }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      authorizeCommentFile(ctx, creator, { fileId: fReply, variant: "thumb" }),
    ).rejects.toThrow(code("forbidden"));
    expect(await listCommentFileViews(ctx, [fReply])).toEqual([]);
    expect(
      await authorizeCommentFile(ctx, creator, { fileId: fThread, variant: "original" }),
    ).toBeTruthy();
    expect((await ctx.commentFiles.findFile(fReply))!.removedAt).toBeDefined();
    expect((await ctx.commentFiles.findFile(fThread))!.removedAt).toBeUndefined();
  });
  it("コメントを削除すると、コメントと返信の添付がすべて読めなくなり、清掃の対象になる", async () => {
    const { ctx, thread, fThread, fReply } = await postedWithReply();
    await deleteThread(ctx, reviewer, { threadId: thread.id });
    for (const fileId of [fThread, fReply])
      await expect(
        authorizeCommentFile(ctx, creator, { fileId, variant: "original" }),
      ).rejects.toThrow(code("forbidden"));
    expect(await listCommentFileViews(ctx, [fThread, fReply])).toEqual([]);

    const orphans = await listOrphanCommentObjects(ctx);
    expect(orphans.map((o) => o.itemId).sort()).toEqual(
      [fThread, fReply].map((id) => `${COMMENT_ORPHAN_PREFIX}${id}`).sort(),
    );
    // 原本とサムネイルの両方を消す対象にする
    for (const o of orphans) {
      expect(o.objectKey).toMatch(/\/attempts\//);
      expect(o.extraObjectKeys).toEqual([expect.stringMatching(/\/thumb$/)]);
    }
    expect(await markCommentObjectsPurged(ctx, [fThread, fReply, fThread])).toBe(2);
    expect(await markCommentObjectsPurged(ctx, [fThread])).toBe(0);
    expect(await listOrphanCommentObjects(ctx)).toEqual([]);
  });
  it("付けないまま 24 時間たった添付は放置扱いになり、付いた添付は消えない", async () => {
    const { ctx, revision } = await setup();
    const kept = await uploadFile(ctx, reviewer, revision.id);
    await postComment(ctx, reviewer, {
      revisionId: revision.id,
      body: "x",
      kind: "discussion",
      severity: "info",
      fileIds: [kept],
    });
    const stale = await uploadFile(ctx, reviewer, revision.id, { thumb: true });
    ctx.clock.advance(COMMENT_FILE_TTL_MS - 1);
    expect(await expireCommentFiles(ctx)).toEqual([]);
    ctx.clock.advance(1);
    expect(await expireCommentFiles(ctx)).toEqual([stale]);
    expect(await expireCommentFiles(ctx)).toEqual([]);
    await expect(
      authorizeCommentFile(ctx, reviewer, { fileId: stale, variant: "original" }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      postComment(ctx, reviewer, {
        revisionId: revision.id,
        body: "y",
        kind: "discussion",
        severity: "info",
        fileIds: [stale],
      }),
    ).rejects.toThrow();
    const orphans = await listOrphanCommentObjects(ctx);
    expect(orphans.map((o) => o.itemId)).toEqual([`${COMMENT_ORPHAN_PREFIX}${stale}`]);
    // 付いた添付は、清掃の記録でも消されない
    expect(await markCommentObjectsPurged(ctx, [kept])).toBe(0);
    expect(await markCommentObjectsPurged(ctx, [stale])).toBe(1);
  });
  it("実体が一度も送られなかった放置の添付は、一覧に出さずその場で清掃済みにする", async () => {
    const { ctx, revision } = await setup();
    const [p] = await prepareCommentFiles(ctx, reviewer, {
      revisionId: revision.id,
      purpose: "comment",
      files: [{ fileName: "a.zip", mimeType: "application/zip", size: 1 }],
    });
    ctx.clock.advance(COMMENT_FILE_TTL_MS);
    await expireCommentFiles(ctx);
    expect(await listOrphanCommentObjects(ctx)).toEqual([]);
    expect((await ctx.commentFiles.findFile(p!.fileId))!.purgedAt).toBeDefined();
  });
});
