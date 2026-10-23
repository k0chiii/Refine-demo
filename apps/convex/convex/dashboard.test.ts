import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

describe("Convex 統合: 校正のナビのバッジ", () => {
  it("自分の未完了の割当と専門確認を数え、受付が終わった版の割当は数えない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    expect(await cast.reviewer.as.query(api.dashboard.checkBadge, {})).toEqual({ count: 0 });

    const assign = async (workId: Parameters<typeof submitFiles>[1]) => {
      const { revisionId } = await submitFiles(cast, workId, pdf);
      await cast.manager.as.mutation(api.reviews.setReviewers, {
        workId,
        reviewerIds: [cast.reviewer.id],
      });
      return revisionId;
    };
    // 受付中の割当 2 件（うち 1 件の版には自分担当の専門確認が 1 件）
    const first = await assign(await setupWork(t, cast, { title: "A" }));
    await assign(await setupWork(t, cast, { title: "B" }));
    // 受付が終わった版の割当と専門確認は数えない
    const closed = await assign(await setupWork(t, cast, { title: "C" }));
    await t.run(async (ctx) => {
      await ctx.db.insert("requiredChecks", {
        revisionId: first,
        type: "photo",
        label: "写真",
        assigneeId: cast.reviewer.id,
        state: "pending",
      });
      await ctx.db.insert("requiredChecks", {
        revisionId: closed,
        type: "photo",
        label: "写真",
        assigneeId: cast.reviewer.id,
        state: "pending",
      });
      await ctx.db.patch(closed, { reviewState: "closed" });
    });

    expect(await cast.reviewer.as.query(api.dashboard.checkBadge, {})).toEqual({ count: 3 });
    // 割当の無い人は 0。校正を完了すると減る
    expect(await cast.creator.as.query(api.dashboard.checkBadge, {})).toEqual({ count: 0 });
    await cast.reviewer.as.mutation(api.reviews.complete, { revisionId: first });
    expect(await cast.reviewer.as.query(api.dashboard.checkBadge, {})).toEqual({ count: 2 });
  });
});
