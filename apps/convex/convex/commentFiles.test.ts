import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, HOUR, type Harness, type TestUser } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });
const SECRET = "test-upload-secret-0123456789";
const SHA = "a".repeat(64);

type Cast = Awaited<ReturnType<typeof createCast>>;

async function setup(over: Record<string, never> = {}) {
  const t = createHarness();
  const cast = await createCast(t);
  const workId = await setupWork(t, cast, over);
  const { revisionId } = await submitFiles(cast, workId, [
    { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" },
  ]);
  return { t, cast, workId, revisionId };
}

/** 準備 → Hono の検証と同じ手順（internal の begin → complete）。画像ならサムネイルも */
async function uploadFile(
  user: TestUser,
  revisionId: Id<"revisions">,
  opts: { purpose?: "comment" | "reply"; thumb?: boolean; file?: Record<string, unknown> } = {},
) {
  const file = {
    fileName: "photo.webp",
    originalName: "IMG_1.png",
    mimeType: "image/webp",
    size: 100,
    originalSize: 900,
    width: 1280,
    height: 720,
    ...opts.file,
  };
  const [p] = await user.as.mutation(api.commentFiles.prepare, {
    revisionId,
    purpose: opts.purpose ?? "comment",
    files: [file as never],
  });
  const fileId = p!.fileId;
  const target = await user.as.mutation(internal.commentFiles.beginFileUpload, { fileId });
  await user.as.mutation(internal.commentFiles.completeFileUpload, {
    attemptId: target.attemptId,
    size: file.size as number,
    sha256: SHA,
  });
  if (opts.thumb) {
    await user.as.mutation(internal.commentFiles.beginThumbUpload, { fileId });
    await user.as.mutation(internal.commentFiles.completeThumbUpload, {
      fileId,
      size: 40,
      mimeType: "image/webp",
    });
  }
  return { fileId, target };
}

const post = async (
  user: TestUser,
  revisionId: Id<"revisions">,
  fileIds: string[],
  body = "見て",
) =>
  (await user.as.mutation(api.comments.post, {
    revisionId,
    body,
    kind: "discussion",
    severity: "info",
    fileIds,
  })) as Id<"commentThreads">;

describe("Convex 統合: コメント・返信の添付", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("準備 → 転送 → コメントに付ける。画面のスレッドに files が載り、見られる人は読める", async () => {
    const { cast, workId, revisionId } = await setup();
    const { fileId, target } = await uploadFile(cast.reviewer, revisionId, { thumb: true });
    expect(target.objectKey.startsWith(`comments/${workId}/${fileId}/`)).toBe(true);
    // 転送は本人の添付だけ
    await expect(
      cast.creator.as.mutation(internal.commentFiles.beginFileUpload, { fileId }),
    ).rejects.toThrow(code("comment_file_not_found"));

    const threadId = await post(cast.reviewer, revisionId, [fileId]);
    const rev = await cast.creator.as.query(api.revisions.get, { revisionId });
    expect(rev.threads.find((x) => x.id === threadId)!.files).toEqual([
      {
        id: fileId,
        name: "photo.webp",
        mime: "image/webp",
        size: 100,
        type: "image",
        width: 1280,
        height: 720,
        hasThumb: true,
      },
    ]);
    // 付けていないコメントは files が空
    const plain = await post(cast.reviewer, revisionId, []);
    expect(
      (await cast.creator.as.query(api.revisions.get, { revisionId })).threads.find(
        (x) => x.id === plain,
      )!.files,
    ).toEqual([]);

    // 見られる人は原本もサムネイルも読める（署名付き URL は無く、認可だけ返す）
    expect(
      await cast.stranger.as.query(api.commentFiles.authorizeFile, { fileId, variant: "original" }),
    ).toMatchObject({ fileName: "photo.webp", size: 100, cacheable: false });
    expect(
      await cast.stranger.as.query(api.commentFiles.authorizeFile, { fileId, variant: "thumb" }),
    ).toMatchObject({ mimeType: "image/webp", size: 40, cacheable: true });
  });

  it("返信にも付けられる。履歴(events)の返信に files が載り、返信の削除で読めなくなる", async () => {
    const { cast, revisionId } = await setup();
    const threadId = await post(cast.reviewer, revisionId, []);
    const { fileId } = await uploadFile(cast.creator, revisionId, {
      purpose: "reply",
      thumb: true,
    });
    await cast.creator.as.mutation(api.comments.reply, { threadId, body: "", fileIds: [fileId] });
    const { events } = await cast.reviewer.as.query(api.comments.events, { threadId });
    const reply = events.find((e) => e.eventType === "replied")!;
    expect(reply.files).toEqual([expect.objectContaining({ id: fileId, hasThumb: true })]);
    expect(events.find((e) => e.eventType === "created")!.files).toEqual([]);

    await cast.creator.as.mutation(api.comments.removeReply, {
      threadId,
      replyEventId: reply.id,
    });
    await expect(
      cast.reviewer.as.query(api.commentFiles.authorizeFile, { fileId, variant: "original" }),
    ).rejects.toThrow(code("forbidden"));
  });

  it("コメントを削除すると添付は読めなくなり、清掃の一覧に原本とサムネイルが載る", async () => {
    const { t, cast, revisionId } = await setup();
    const { fileId } = await uploadFile(cast.reviewer, revisionId, { thumb: true });
    const threadId = await post(cast.reviewer, revisionId, [fileId]);
    await cast.reviewer.as.mutation(api.comments.remove, { threadId });
    await expect(
      cast.creator.as.query(api.commentFiles.authorizeFile, { fileId, variant: "original" }),
    ).rejects.toThrow(code("forbidden"));
    const orphans = await t.mutation(internal.submissions.listOrphanObjects, {});
    expect(orphans).toEqual([
      {
        itemId: `comment:${fileId}`,
        objectKey: expect.stringContaining(`comments/`),
        extraObjectKeys: [expect.stringMatching(/\/thumb$/)],
      },
    ]);
    expect(
      await t.mutation(internal.submissions.markObjectsPurged, {
        itemIds: orphans.map((o) => o.itemId),
      }),
    ).toBe(1);
    expect(await t.mutation(internal.submissions.listOrphanObjects, {})).toEqual([]);
  });

  it("委員なら添付を読める。付けられない添付があるとコメントは投稿されない（105A）", async () => {
    const { cast, revisionId } = await setup();
    const { fileId } = await uploadFile(cast.reviewer, revisionId);
    const mine2 = (
      await cast.reviewer.as.mutation(api.commentFiles.prepare, {
        revisionId,
        purpose: "comment",
        files: [{ fileName: "x.webp", mimeType: "image/webp", size: 1 }],
      })
    )[0]!.fileId;
    await expect(post(cast.reviewer, revisionId, [fileId, mine2])).rejects.toThrow(
      code("comment_file_not_ready"),
    );
    const threadId = await post(cast.reviewer, revisionId, [fileId]);
    expect(
      await cast.stranger.as.query(api.commentFiles.authorizeFile, { fileId, variant: "original" }),
    ).toMatchObject({ fileName: expect.any(String) });
    await expect(
      cast.stranger.as.mutation(api.commentFiles.prepare, {
        revisionId,
        purpose: "reply",
        files: [{ fileName: "x.webp", mimeType: "image/webp", size: 1 }],
      }),
    ).resolves.toHaveLength(1);
    expect(threadId).toBeTruthy();
    const { fileId: withThumb } = await uploadFile(cast.reviewer, revisionId, { thumb: true });
    await post(cast.reviewer, revisionId, [withThumb]);
    expect(
      await cast.creator.as.query(api.commentFiles.authorizeFile, {
        fileId: withThumb,
        variant: "thumb",
      }),
    ).toMatchObject({ cacheable: true });
  });

  it("24 時間たっても付かなかった添付は放置扱いになり、清掃の一覧に載る。付いた添付は残る", async () => {
    const { t, cast, revisionId } = await setup();
    const { fileId: kept } = await uploadFile(cast.reviewer, revisionId);
    await post(cast.reviewer, revisionId, [kept]);
    const { fileId: stale } = await uploadFile(cast.reviewer, revisionId, { thumb: true });
    expect(await t.mutation(internal.commentFiles.expireFiles, {})).toBe(0);
    vi.setSystemTime(Date.now() + 25 * HOUR);
    expect(await t.mutation(internal.commentFiles.expireFiles, {})).toBe(1);
    expect(await t.mutation(internal.commentFiles.expireFiles, {})).toBe(0);
    const orphans = await t.mutation(internal.submissions.listOrphanObjects, {});
    expect(orphans.map((o) => o.itemId)).toEqual([`comment:${stale}`]);
    await expect(
      cast.reviewer.as.query(api.commentFiles.authorizeFile, {
        fileId: stale,
        variant: "original",
      }),
    ).rejects.toThrow(code("forbidden"));
    expect(
      await cast.creator.as.query(api.commentFiles.authorizeFile, {
        fileId: kept,
        variant: "original",
      }),
    ).toBeTruthy();
  });

  it("旧い行(fileIds の無いスレッド・返信)も読める（後方互換）", async () => {
    const { t, cast, revisionId } = await setup();
    const threadId = await t.run(async (ctx) =>
      ctx.db.insert("commentThreads", {
        revisionId,
        authorId: cast.reviewer.id,
        body: "昔のコメント",
        kind: "correction",
        severity: "minor",
        resolution: "open",
        createdAt: Date.now(),
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("commentEvents", {
        threadId,
        eventType: "replied",
        actorId: cast.creator.id,
        payload: { body: "返信" },
        createdAt: Date.now(),
      }),
    );
    const rev = await cast.creator.as.query(api.revisions.get, { revisionId });
    expect(rev.threads.find((x) => x.id === threadId)!.files).toEqual([]);
    const { events } = await cast.creator.as.query(api.comments.events, { threadId });
    expect(events.find((e) => e.eventType === "replied")!.files).toEqual([]);
  });
});

describe("Convex 統合: コメントの添付のサービス境界（http.ts）", () => {
  async function withSecret(
    run: (t: Harness, cast: Cast, revisionId: Id<"revisions">) => Promise<void>,
  ) {
    const prev = process.env.MF100_UPLOAD_SECRET;
    process.env.MF100_UPLOAD_SECRET = SECRET;
    try {
      const { t, cast, revisionId } = await setup();
      await run(t, cast, revisionId);
    } finally {
      if (prev === undefined) delete process.env.MF100_UPLOAD_SECRET;
      else process.env.MF100_UPLOAD_SECRET = prev;
    }
  }
  const post = (
    who: { fetch: Harness["fetch"] },
    path: string,
    body: unknown,
    key: string | null = SECRET,
  ) =>
    who.fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key !== null ? { "X-MF100-Service-Key": key } : {}),
      },
      body: JSON.stringify(body),
    });

  it("共有秘密と利用者の JWT の両方が要り、begin → complete で検証済みになる。サムネイルも同じ", async () => {
    await withSecret(async (t, cast, revisionId) => {
      const [p] = await cast.reviewer.as.mutation(api.commentFiles.prepare, {
        revisionId,
        purpose: "comment",
        files: [{ fileName: "p.webp", mimeType: "image/webp", size: 7, width: 10, height: 10 }],
      });
      const fileId = p!.fileId;
      // 秘密が無い・利用者が居ない・他人は動かせない
      expect(
        (await post(cast.reviewer.as, "/internal/comments/files/begin", { fileId }, null)).status,
      ).toBe(404);
      expect((await post(t, "/internal/comments/files/begin", { fileId })).status).toBe(401);
      const foreign = await post(cast.creator.as, "/internal/comments/files/begin", { fileId });
      expect(foreign.status).toBe(409);
      expect(await foreign.json()).toMatchObject({ code: "comment_file_not_found" });

      const begin = (await (
        await post(cast.reviewer.as, "/internal/comments/files/begin", { fileId })
      ).json()) as { attemptId: string; objectKey: string };
      expect(
        (
          await post(cast.reviewer.as, "/internal/comments/files/complete", {
            attemptId: begin.attemptId,
            size: 7,
            sha256: "zz",
          })
        ).status,
      ).toBe(400);
      const done = await post(cast.reviewer.as, "/internal/comments/files/complete", {
        attemptId: begin.attemptId,
        size: 7,
        sha256: SHA,
      });
      expect(await done.json()).toEqual({ status: "verified", failureMessage: null });

      // サムネイル: 形式・大きさはここでも検査する
      const thumbBegin = await post(cast.reviewer.as, "/internal/comments/thumbs/begin", {
        fileId,
      });
      expect(await thumbBegin.json()).toMatchObject({
        objectKey: `${begin.objectKey.split("/attempts/")[0]}/thumb`,
      });
      expect(
        (
          await post(cast.reviewer.as, "/internal/comments/thumbs/complete", {
            fileId,
            size: 10,
            mimeType: "image/png",
          })
        ).status,
      ).toBe(409);
      const ok = await post(cast.reviewer.as, "/internal/comments/thumbs/complete", {
        fileId,
        size: 10,
        mimeType: "image/webp",
      });
      expect(await ok.json()).toEqual({ hasThumb: true });
      expect(
        (await post(cast.reviewer.as, "/internal/comments/thumbs/complete", { fileId })).status,
      ).toBe(400);

      // 失敗の補償
      const [q] = await cast.reviewer.as.mutation(api.commentFiles.prepare, {
        revisionId,
        purpose: "comment",
        files: [{ fileName: "q.pdf", mimeType: "application/pdf", size: 7 }],
      });
      const b2 = (await (
        await post(cast.reviewer.as, "/internal/comments/files/begin", { fileId: q!.fileId })
      ).json()) as { attemptId: string };
      expect(
        (
          await post(cast.reviewer.as, "/internal/comments/files/fail", {
            attemptId: b2.attemptId,
            message: "破損",
          })
        ).status,
      ).toBe(200);
    });
  });
});
