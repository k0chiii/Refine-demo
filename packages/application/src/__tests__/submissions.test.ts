import { describe, expect, it } from "vite-plus/test";
import {
  confirmSubmission,
  prepareSubmission,
  recordItemFailed,
  recordItemVerified,
  resetItem,
} from "../usecases/submissions.ts";
import { postComment } from "../usecases/comments.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

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
    await recordItemVerified(ctx, principals.creator, { itemId: a!.id, size: 10, sha256: "a" });
    await recordItemVerified(ctx, principals.creator, { itemId: b!.id, size: 10, sha256: "b" });
    await recordItemFailed(ctx, principals.creator, {
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
    await recordItemVerified(ctx, principals.creator, { itemId: ai!.id, size: 10, sha256: "c" });
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
    const item = await recordItemVerified(ctx, principals.creator, {
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
    await recordItemVerified(ctx, principals.creator, {
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
      recordItemVerified(ctx, principals.stranger, {
        itemId: prepared.items[0]!.id,
        size: 1,
        sha256: "x",
      }),
    ).rejects.toThrow(code("upload_item_not_found"));
  });
});
