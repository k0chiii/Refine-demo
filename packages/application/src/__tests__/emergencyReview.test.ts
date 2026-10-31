import { describe, expect, it } from "vite-plus/test";
import { defaultSubmitDeadlineAt } from "@mf100/domain";
import { prepareSubmission } from "../usecases/submissions.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork } from "../testing/scenario.ts";

describe("緊急校正（98A / 99B）", () => {
  it("通常提出も校正期日が必須", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(
      prepareSubmission(ctx, principals.creator, {
        workId: work.id,
        kind: "standard",
        reviewType: "general",
        deadlineAt: undefined as unknown as number,
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

  it("緊急提出は reviewUrgent と短い deadlineAt を付ける", async () => {
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
    expect(prepared.session).toMatchObject({ reviewUrgent: true, deadlineAt: at });
  });

  it("緊急で上限を超える校正期日は拒否する", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const max = defaultSubmitDeadlineAt(ctx.clock.now());
    await expect(
      prepareSubmission(ctx, principals.creator, {
        workId: work.id,
        kind: "standard",
        reviewType: "general",
        reviewUrgent: true,
        deadlineAt: max + 1,
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
    ).rejects.toMatchObject({ code: "revision_deadline_after_max" });
  });
});
