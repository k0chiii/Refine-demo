import { describe, expect, it } from "vite-plus/test";
import {
  byteLength,
  emptyPost,
  postManifest,
  UPLOAD_ATTEMPT_TTL_MS,
  type Principal,
} from "@mf100/domain";
import {
  beginItemUpload,
  completeItemUpload,
  confirmSubmission,
  failItemUpload,
  prepareSubmission,
  resetItem,
} from "../usecases/submissions.ts";
import { listOrphanAttemptObjects, markAttemptObjectsPurged } from "../usecases/uploadAttempts.ts";
import { postComment } from "../usecases/comments.ts";
import { createInMemoryContext, type InMemoryContext } from "../testing/inMemory.ts";
import {
  HOUR,
  principals,
  seedWork,
  submitRevision,
  uploadVerifiedItem,
} from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

/** Hono が転送に失敗したときと同じ手順（試行の開始 → 失敗の記録） */
async function uploadFailedItem(
  ctx: InMemoryContext,
  principal: Principal,
  input: { itemId: string; message: string },
) {
  const { attemptId } = await beginItemUpload(ctx, principal, { itemId: input.itemId });
  await failItemUpload(ctx, principal, { attemptId, message: input.message });
}

async function prepareOne(ctx: InMemoryContext, workId: string) {
  return prepareSubmission(ctx, principals.creator, {
    workId,
    kind: "standard",
    reviewType: "general",
    deadlineAt: ctx.clock.now() + 24 * HOUR,
    changeSummary: "",
    focusNotes: "",
    items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
  });
}

describe("版提出: 準備と確定の分離（F-04, A-02, A-16, A-17）", () => {
  it("A-17: 第2版の提出確定が第1版を superseded で閉じ、第1版への新規コメントは拒否される", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const r1 = await submitRevision(ctx, work.id);
    ctx.clock.advance(HOUR);
    const r2 = await submitRevision(ctx, work.id);

    const stored1 = await ctx.revisions.findById(r1.id);
    expect(stored1?.reviewState).toBe("closed");
    expect(stored1?.reviewClosedReason).toBe("superseded");
    expect(stored1?.supersededByRevisionId).toBe(r2.id);
    expect(r2.sequence).toBe(2);
    expect(r2.reviewState).toBe("open");

    // 以前の指摘は残る前提で、第1版には新規投稿できない
    await expect(
      postComment(ctx, principals.creator, {
        revisionId: r1.id,
        body: "x",
        kind: "correction",
        severity: "minor",
      }),
    ).rejects.toThrow(code("revision_not_accepting"));
    await expect(
      postComment(ctx, principals.creator, {
        revisionId: r2.id,
        body: "x",
        kind: "correction",
        severity: "minor",
      }),
    ).resolves.toMatchObject({ revisionId: r2.id });
  });

  it("A-16 / A-02: ファイル1件の失敗で確定できず、第1版の受付は維持される。再アップロード後に確定できる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const r1 = await submitRevision(ctx, work.id);

    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + 48 * HOUR,
      changeSummary: "修正",
      focusNotes: "",
      items: [
        { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" },
        { fileName: "b.pdf", mimeType: "application/pdf", type: "pdf", role: "source" },
        { fileName: "orig.ai", mimeType: "application/postscript", type: "other", role: "source" },
      ],
    });
    const [a, b, ai] = prepared.items;
    await uploadVerifiedItem(ctx, principals.creator, { itemId: a!.id, size: 10, sha256: "a" });
    await uploadVerifiedItem(ctx, principals.creator, { itemId: b!.id, size: 10, sha256: "b" });
    await uploadFailedItem(ctx, principals.creator, {
      itemId: ai!.id,
      message: "通信が切断されました",
    });

    let error: unknown;
    await confirmSubmission(ctx, principals.creator, { sessionId: prepared.session.id }).catch(
      (e: unknown) => (error = e),
    );
    expect(error).toMatchObject({ code: "revision_artifacts_not_verified" });
    // 原因と復旧対象（ファイル名・状態・理由）が分かる
    expect((error as { details: { items: unknown[] } }).details.items).toEqual([
      expect.objectContaining({
        fileName: "orig.ai",
        status: "failed",
        failureMessage: "通信が切断されました",
      }),
    ]);

    // 第1版はまだ受付中、第2版は存在しない
    expect((await ctx.revisions.findById(r1.id))?.reviewState).toBe("open");
    expect((await ctx.revisions.listByWork(work.id)).length).toBe(1);

    // 失敗ファイルだけ再送して確定
    await resetItem(ctx, principals.creator, { itemId: ai!.id });
    await uploadVerifiedItem(ctx, principals.creator, { itemId: ai!.id, size: 10, sha256: "c" });
    const { revision, supersededRevisionId } = await confirmSubmission(ctx, principals.creator, {
      sessionId: prepared.session.id,
    });
    expect(revision.sequence).toBe(2);
    expect(supersededRevisionId).toBe(r1.id);
    expect((await ctx.artifacts.listByRevision(revision.id)).length).toBe(3);
  });

  it("申告サイズと実体サイズが異なるファイルは failed になる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + HOUR,
      changeSummary: "",
      focusNotes: "",
      items: [
        {
          fileName: "a.pdf",
          mimeType: "application/pdf",
          type: "pdf",
          role: "source",
          declaredSize: 100,
        },
      ],
    });
    const item = await uploadVerifiedItem(ctx, principals.creator, {
      itemId: prepared.items[0]!.id,
      size: 99,
      sha256: "x",
    });
    expect(item.status).toBe("failed");
  });

  it("A-10: 同じ requestId の確定再送は二重版を作らない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + HOUR,
      changeSummary: "",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
    });
    await uploadVerifiedItem(ctx, principals.creator, {
      itemId: prepared.items[0]!.id,
      size: 1,
      sha256: "x",
    });
    const first = await confirmSubmission(ctx, principals.creator, {
      sessionId: prepared.session.id,
      requestId: "req-1",
    });
    const second = await confirmSubmission(ctx, principals.creator, {
      sessionId: prepared.session.id,
      requestId: "req-1",
    });
    const third = await confirmSubmission(ctx, principals.creator, {
      sessionId: prepared.session.id,
    }); // requestId 無しの再送
    expect(second.revision.id).toBe(first.revision.id);
    expect(third.revision.id).toBe(first.revision.id);
    expect((await ctx.revisions.listByWork(work.id)).length).toBe(1);
  });

  it("A-18: 0版（ラフ）→ 第1版。0版はラフとして残り、通常版は第1版から始まる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const r0 = await submitRevision(ctx, work.id, { kind: "rough" });
    expect(r0).toMatchObject({ kind: "rough", sequence: 0 });
    const t = await postComment(ctx, principals.creator, {
      revisionId: r0.id,
      body: "方向性OK",
      kind: "decision",
      severity: "info",
    });
    ctx.clock.advance(HOUR);
    const r1 = await submitRevision(ctx, work.id);
    expect(r1).toMatchObject({ kind: "standard", sequence: 1 });
    expect((await ctx.revisions.findById(r0.id))?.reviewClosedReason).toBe("superseded");
    expect(await ctx.threads.findById(t.id)).not.toBeNull(); // 0版の指摘は履歴として残る
    await expect(submitRevision(ctx, work.id, { kind: "rough" })).rejects.toThrow(
      code("revision_rough_after_standard"),
    );
  });

  it("0版は通常版の前なら再提出できる。旧ラフは superseded、通常版は第1版から", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const r0a = await submitRevision(ctx, work.id, { kind: "rough" });
    ctx.clock.advance(HOUR);
    const r0b = await submitRevision(ctx, work.id, { kind: "rough" });
    expect(r0b).toMatchObject({ kind: "rough", sequence: 1 });
    expect((await ctx.revisions.findById(r0a.id))?.reviewClosedReason).toBe("superseded");
    ctx.clock.advance(HOUR);
    expect((await submitRevision(ctx, work.id)).sequence).toBe(1);
  });

  it("制作者以外（校正者・無関係者）は版を提出できない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(submitRevision(ctx, work.id, { principal: principals.reviewer })).rejects.toThrow(
      code("forbidden"),
    );
    await expect(submitRevision(ctx, work.id, { principal: principals.stranger })).rejects.toThrow(
      code("forbidden"),
    );
  });

  it("他人のアップロード項目は存在を漏らさず not_found", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + HOUR,
      changeSummary: "",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
    });
    await expect(
      uploadVerifiedItem(ctx, principals.stranger, {
        itemId: prepared.items[0]!.id,
        size: 1,
        sha256: "x",
      }),
    ).rejects.toThrow(code("upload_item_not_found"));
  });
});

describe("実体の転送: 試行ごとのキーと原子的な採用（P1: 確定した実体を遅れた PUT から守る）", () => {
  it("同じ項目への 2 つの試行は別のキーに書き、先に検証された 1 つだけが採用される。遅れた試行は確定後に採用されず、清掃の対象になる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const prepared = await prepareOne(ctx, work.id);
    const itemId = prepared.items[0]!.id;

    // A と B が両方とも受付確認を通過する
    const a = await beginItemUpload(ctx, principals.creator, { itemId });
    const b = await beginItemUpload(ctx, principals.creator, { itemId });
    expect(a.objectKey).not.toBe(b.objectKey);
    expect(a.objectKey.startsWith(`works/${work.id}/sessions/${prepared.session.id}/`)).toBe(true);

    // A が先に検証され、採用される
    const verified = await completeItemUpload(ctx, principals.creator, {
      attemptId: a.attemptId,
      size: 10,
      sha256: "a01",
    });
    expect(verified).toMatchObject({ status: "verified", objectKey: a.objectKey, sha256: "a01" });

    // B は同じ項目を上書き採用できない（項目は検証済み）。失敗の補償でも A の採用は崩れない
    await expect(
      completeItemUpload(ctx, principals.creator, {
        attemptId: b.attemptId,
        size: 10,
        sha256: "b02",
      }),
    ).rejects.toThrow(code("upload_item_invalid_state"));
    await failItemUpload(ctx, principals.creator, {
      attemptId: b.attemptId,
      message: "upload_item_invalid_state",
    });
    expect(await ctx.uploads.findItem(itemId)).toMatchObject({
      status: "verified",
      objectKey: a.objectKey,
      sha256: "a01",
    });

    // 確定した Artifact は A のキーを参照する
    const { revision } = await confirmSubmission(ctx, principals.creator, {
      sessionId: prepared.session.id,
    });
    const [artifact] = await ctx.artifacts.listByRevision(revision.id);
    expect(artifact).toMatchObject({ objectKey: a.objectKey, sha256: "a01" });

    // 確定後に届いた試行は受け付けず、遅れて届いた B の検証完了も採用されない
    await expect(beginItemUpload(ctx, principals.creator, { itemId })).rejects.toThrow(
      code("upload_session_not_open"),
    );
    await expect(
      completeItemUpload(ctx, principals.creator, {
        attemptId: b.attemptId,
        size: 10,
        sha256: "b02",
      }),
    ).rejects.toThrow(code("upload_session_not_open"));

    // 清掃: 破棄した B のキーだけが対象。採用済みの A は列挙も削除記録もされない
    expect(await listOrphanAttemptObjects(ctx)).toEqual([
      { itemId: `attempt:${b.attemptId}`, objectKey: b.objectKey },
    ]);
    expect(await markAttemptObjectsPurged(ctx, [a.attemptId])).toBe(0);
    expect(await markAttemptObjectsPurged(ctx, [b.attemptId, b.attemptId])).toBe(1);
    expect(await listOrphanAttemptObjects(ctx)).toEqual([]);
  });

  it("期限を過ぎた試行は採用されず、清掃の対象になる（清掃が消した実体を後から採用しない）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const prepared = await prepareOne(ctx, work.id);
    const itemId = prepared.items[0]!.id;
    const a = await beginItemUpload(ctx, principals.creator, { itemId });
    expect(await listOrphanAttemptObjects(ctx)).toEqual([]);
    ctx.clock.advance(UPLOAD_ATTEMPT_TTL_MS);
    expect(await listOrphanAttemptObjects(ctx)).toEqual([
      { itemId: `attempt:${a.attemptId}`, objectKey: a.objectKey },
    ]);
    await expect(
      completeItemUpload(ctx, principals.creator, { attemptId: a.attemptId, size: 1, sha256: "x" }),
    ).rejects.toThrow(code("upload_attempt_closed"));
    // 新しい試行なら採用できる
    expect(
      await uploadVerifiedItem(ctx, principals.creator, { itemId, size: 1, sha256: "y" }),
    ).toMatchObject({ status: "verified" });
  });

  it("申告サイズと違う実体は採用せず破棄する。他人の試行は存在を漏らさない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + HOUR,
      changeSummary: "",
      focusNotes: "",
      items: [
        {
          fileName: "a.pdf",
          mimeType: "application/pdf",
          type: "pdf",
          role: "source",
          declaredSize: 100,
        },
      ],
    });
    const a = await beginItemUpload(ctx, principals.creator, { itemId: prepared.items[0]!.id });
    await expect(
      completeItemUpload(ctx, principals.stranger, {
        attemptId: a.attemptId,
        size: 100,
        sha256: "x",
      }),
    ).rejects.toThrow(code("upload_attempt_not_found"));
    await expect(
      failItemUpload(ctx, principals.stranger, { attemptId: a.attemptId, message: "x" }),
    ).rejects.toThrow(code("upload_attempt_not_found"));
    const item = await completeItemUpload(ctx, principals.creator, {
      attemptId: a.attemptId,
      size: 99,
      sha256: "x",
    });
    expect(item.status).toBe("failed");
    expect(item.objectKey).toBeUndefined();
    expect((await listOrphanAttemptObjects(ctx)).map((o) => o.objectKey)).toEqual([a.objectKey]);
  });

  it("検証済みの項目をやり直すと、採用していた実体を手放し清掃の対象にする", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const prepared = await prepareOne(ctx, work.id);
    const itemId = prepared.items[0]!.id;
    const first = await uploadVerifiedItem(ctx, principals.creator, {
      itemId,
      size: 1,
      sha256: "x",
    });
    await resetItem(ctx, principals.creator, { itemId });
    const item = await ctx.uploads.findItem(itemId);
    expect(item).toMatchObject({ status: "pending" });
    expect(item?.objectKey).toBeUndefined();
    expect((await listOrphanAttemptObjects(ctx)).map((o) => o.objectKey)).toEqual([
      first.objectKey,
    ]);
  });
});

describe("同時提出の競合（P2: §5.2-11 競合する同時提出を一件だけ確定する）", () => {
  it("同じ作品の状態から準備した 2 つの提出は、比較条件を渡さなくても先に確定した 1 件だけが成功する", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const a = await prepareOne(ctx, work.id);
    const b = await prepareOne(ctx, work.id);
    for (const p of [a, b])
      await uploadVerifiedItem(ctx, principals.creator, {
        itemId: p.items[0]!.id,
        size: 1,
        sha256: "x",
      });

    const first = await confirmSubmission(ctx, principals.creator, { sessionId: a.session.id });
    expect(first.revision.sequence).toBe(1);
    await expect(
      confirmSubmission(ctx, principals.creator, { sessionId: b.session.id }),
    ).rejects.toThrow(code("revision_submission_conflict"));
    // A の受付は終了しない。版は 1 件のまま。B は準備し直せば提出できる
    const revisions = await ctx.revisions.listByWork(work.id);
    expect(revisions.map((r) => [r.id, r.reviewState])).toEqual([[first.revision.id, "open"]]);
    expect((await ctx.uploads.findById(b.session.id))?.state).toBe("open");
    ctx.clock.advance(HOUR);
    expect((await submitRevision(ctx, work.id)).sequence).toBe(2);
  });
});

describe("版提出: SNS 投稿の内容の記録と添付の対応（PR #1 レビュー）", () => {
  it("記録にある画像が添付に無い版は準備の時点で拒否する。そろっていれば準備できる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const image = (k: string) => ({
      key: k,
      fileName: `${k}.jpg`,
      alt: "説明",
      aspect: "1:1" as const,
    });
    const postSnapshot = postManifest({
      ...emptyPost("instagram"),
      images: [image("01-a"), image("02-b")],
    });
    const file = (fileName: string, declaredSize = 10) => ({
      fileName,
      mimeType: "image/jpeg",
      type: "image" as const,
      role: "source" as const,
      declaredSize,
    });
    const items = (images: string[]) => [
      { ...file("post-body.txt", 3), mimeType: "text/plain", type: "document" as const },
      ...images.map((n) => file(n)),
      {
        ...file("mf100-post.json", byteLength(postSnapshot)),
        mimeType: "application/json",
        type: "document" as const,
      },
    ];
    const input = {
      workId: work.id,
      kind: "standard" as const,
      reviewType: "general",
      deadlineAt: ctx.clock.now() + 24 * HOUR,
      changeSummary: "",
      focusNotes: "",
    };
    await expect(
      prepareSubmission(ctx, principals.creator, {
        ...input,
        items: items(["01-a.jpg"]),
        postSnapshot,
      }),
    ).rejects.toThrow(code("post_snapshot_mismatch"));
    // 記録を添付するのに、準備で記録を渡さない（検査の迂回）も拒否する
    await expect(
      prepareSubmission(ctx, principals.creator, { ...input, items: items(["01-a.jpg"]) }),
    ).rejects.toThrow(code("post_snapshot_mismatch"));
    const ok = await prepareSubmission(ctx, principals.creator, {
      ...input,
      items: items(["01-a.jpg", "02-b.jpg"]),
      postSnapshot,
    });
    expect(ok.items.map((i) => i.fileName)).toEqual([
      "post-body.txt",
      "01-a.jpg",
      "02-b.jpg",
      "mf100-post.json",
    ]);
  });
});

describe("グラフィック制作物の提出: PDF・画像・Illustrator・InDesign（利用者指示 2026-10-19）", () => {
  type Item = { fileName: string; mimeType: string; type: "pdf" | "image" | "other" };
  const AI: Item = { fileName: "poster.ai", mimeType: "application/postscript", type: "other" };
  const INDD: Item = { fileName: "poster.indd", mimeType: "", type: "other" };
  const PDF: Item = { fileName: "poster.pdf", mimeType: "application/pdf", type: "pdf" };
  const PNG: Item = { fileName: "poster.png", mimeType: "image/png", type: "image" };

  /** 準備 → 各ファイルを検証済みに（.ai は Worker が見た PDF 互換の結果を添える）→ 確定の関数を返す */
  async function submitGraphic(
    mediaType: "pdf" | "image" | "video",
    files: Item[],
    opts: { aiPdfCompatible?: boolean } = {},
  ) {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { mediaType });
    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + 24 * HOUR,
      changeSummary: "",
      focusNotes: "",
      items: files.map((f) => ({ ...f, role: "source" as const, declaredSize: 1000 })),
    });
    for (const item of prepared.items)
      await uploadVerifiedItem(ctx, principals.creator, {
        itemId: item.id,
        size: 1000,
        sha256: "abc",
        ...(item.fileName.endsWith(".ai") && opts.aiPdfCompatible !== undefined
          ? { pdfCompatible: opts.aiPdfCompatible }
          : {}),
      });
    return {
      ctx,
      prepared,
      confirm: () => confirmSubmission(ctx, principals.creator, { sessionId: prepared.session.id }),
    };
  }

  it.each(["pdf", "image"] as const)(
    "%s の制作物: PDF と .ai と .indd を一緒に出せて、.ai・.indd は MIME を拡張子から決めたダウンロード用の原本になる",
    async (mediaType) => {
      const { ctx, prepared, confirm } = await submitGraphic(mediaType, [PDF, AI, INDD], {
        aiPdfCompatible: false,
      });
      const { revision } = await confirm();
      const artifacts = await ctx.artifacts.listByRevision(revision.id);
      const by = (name: string) => artifacts.find((x) => x.fileName === name)!;
      expect(by("poster.pdf").type).toBe("pdf");
      expect(by("poster.ai")).toMatchObject({ type: "other", mimeType: "application/illustrator" });
      expect(by("poster.indd")).toMatchObject({
        type: "other",
        mimeType: "application/x-indesign",
      });
      expect(prepared.items.map((i) => i.mimeType)).toEqual([
        "application/pdf",
        "application/illustrator",
        "application/x-indesign",
      ]);
    },
  );

  it("PDF 互換の .ai は検証で PDF の種類になり、元の .ai のファイル名のまま残る", async () => {
    const { ctx, confirm } = await submitGraphic("pdf", [AI], { aiPdfCompatible: true });
    const { revision } = await confirm();
    const [artifact] = await ctx.artifacts.listByRevision(revision.id);
    expect(artifact).toMatchObject({ type: "pdf", fileName: "poster.ai", status: "verified" });
  });

  it("PDF 互換と確かめていない .ai は、種類が pdf と申告されていても PDF にならない", async () => {
    const { ctx, confirm } = await submitGraphic("pdf", [{ ...AI, type: "pdf" }, PNG], {});
    const { revision } = await confirm();
    const artifacts = await ctx.artifacts.listByRevision(revision.id);
    expect(artifacts.find((x) => x.fileName === "poster.ai")?.type).toBe("other");
  });

  it("紙面に出せるファイルが無い提出（.indd だけ・PDF 互換でない .ai だけ）は確定で断る。旧版の受付は変わらない", async () => {
    for (const files of [[INDD], [AI, INDD]]) {
      const { ctx, prepared, confirm } = await submitGraphic("pdf", files, {
        aiPdfCompatible: false,
      });
      await expect(confirm()).rejects.toMatchObject({ code: "revision_no_reviewable_file" });
      expect(await ctx.revisions.listByWork(prepared.session.workId)).toHaveLength(0);
      expect((await ctx.uploads.findById(prepared.session.id))?.state).toBe("open");
    }
  });

  it("断られても、書き出した PDF か画像を足して出し直せる", async () => {
    const { ctx, prepared, confirm } = await submitGraphic("image", [INDD]);
    await expect(confirm()).rejects.toMatchObject({ code: "revision_no_reviewable_file" });
    const again = await prepareSubmission(ctx, principals.creator, {
      workId: prepared.session.workId,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + 24 * HOUR,
      changeSummary: "",
      focusNotes: "",
      items: [INDD, PNG].map((f) => ({ ...f, role: "source" as const })),
    });
    for (const item of again.items)
      await uploadVerifiedItem(ctx, principals.creator, {
        itemId: item.id,
        size: 1000,
        sha256: "abc",
      });
    const { revision } = await confirmSubmission(ctx, principals.creator, {
      sessionId: again.session.id,
    });
    expect(revision.sequence).toBe(1);
  });

  it("グラフィック以外（動画）の制作物には、紙面に出せるファイルの規則を課さない", async () => {
    const { confirm } = await submitGraphic("video", [INDD]);
    await expect(confirm()).resolves.toBeDefined();
  });

  it("1 ファイルの上限を超える申告は準備の時点で断る。数十 MB の原本は通る", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const base = {
      workId: work.id,
      kind: "standard" as const,
      reviewType: "general",
      deadlineAt: ctx.clock.now() + 24 * HOUR,
      changeSummary: "",
      focusNotes: "",
    };
    await expect(
      prepareSubmission(ctx, principals.creator, {
        ...base,
        items: [{ ...INDD, role: "source", declaredSize: 450_000_000 }],
      }),
    ).rejects.toMatchObject({ code: "upload_file_too_large" });
    // 原本は gzip して上げられるので、元の大きさは本文の上限の 4 倍（400 MB）まで申告できる
    await expect(
      prepareSubmission(ctx, principals.creator, {
        ...base,
        items: [{ ...INDD, role: "source", declaredSize: 150_000_000 }],
      }),
    ).resolves.toBeDefined();
    // 圧縮できない種類（PDF など）は従来どおり 100 MB まで
    await expect(
      prepareSubmission(ctx, principals.creator, {
        ...base,
        items: [
          {
            fileName: "big.pdf",
            mimeType: "application/pdf",
            type: "pdf",
            role: "source",
            declaredSize: 150_000_000,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "upload_file_too_large" });
    await expect(
      prepareSubmission(ctx, principals.creator, {
        ...base,
        items: [{ ...INDD, role: "source", declaredSize: 80_000_000 }],
      }),
    ).resolves.toBeDefined();
  });

  it("external 添付の URL は https のみ（95A）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const base = {
      workId: work.id,
      kind: "standard" as const,
      reviewType: "general" as const,
      deadlineAt: ctx.clock.now() + 24 * HOUR,
      changeSummary: "",
      focusNotes: "",
    };
    await expect(
      prepareSubmission(ctx, principals.creator, {
        ...base,
        items: [
          {
            fileName: "http://example.com/",
            mimeType: "text/uri-list",
            type: "external_link",
            role: "external",
            externalUrl: "http://example.com/",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "anchor_invalid",
      details: { reason: "external_url_https_required" },
    });
  });
});
