import { describe, expect, it } from "vite-plus/test";
import { closeExpiredReviews } from "../usecases/reviews.ts";
import { confirmSubmission, prepareSubmission } from "../usecases/submissions.ts";
import { postComment } from "../usecases/comments.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import {
  HOUR,
  principals,
  seedWork,
  submitRevision,
  uploadVerifiedItem,
} from "../testing/scenario.ts";

describe("緊急校正（提出トグル + 校正期限）", () => {
  it("通常提出は校正期限を付けず、期限ジョブの対象にならない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const revision = await submitRevision(ctx, work.id);
    expect(revision.deadlineAt).toBeUndefined();
    expect(revision.reviewUrgent).toBeUndefined();
    ctx.clock.current += 365 * 24 * HOUR;
    expect(await closeExpiredReviews(ctx)).toEqual([]);
    await expect(
      postComment(ctx, principals.creator, {
        revisionId: revision.id,
        body: "メモ",
        kind: "question",
        severity: "info",
      }),
    ).resolves.toBeTruthy();
  });

  it("緊急提出は reviewUrgent と deadlineAt を付ける", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const at = ctx.clock.now() + 6 * HOUR;
    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      reviewUrgent: true,
      deadlineAt: at,
      changeSummary: "急ぎ",
      focusNotes: "",
      items: [
        {
          fileName: "a.pdf",
          mimeType: "application/pdf",
          type: "pdf",
          role: "source",
        },
      ],
    });
    for (const item of prepared.items) {
      await uploadVerifiedItem(ctx, principals.creator, {
        itemId: item.id,
        size: 100,
        sha256: "x",
      });
    }
    const { revision } = await confirmSubmission(ctx, principals.creator, {
      sessionId: prepared.session.id,
    });
    expect(revision).toMatchObject({ reviewUrgent: true, deadlineAt: at });
  });

  it("reviewUrgent だけで deadline 無しは拒否する", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(
      prepareSubmission(ctx, principals.creator, {
        workId: work.id,
        kind: "standard",
        reviewType: "general",
        reviewUrgent: true,
        changeSummary: "",
        focusNotes: "",
        items: [
          {
            fileName: "a.pdf",
            mimeType: "application/pdf",
            type: "pdf",
            role: "source",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "revision_deadline_required" });
  });
});
