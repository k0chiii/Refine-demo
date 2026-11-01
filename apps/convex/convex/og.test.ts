import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";

/**
 * リンクのプレビュー（OGP）の公開の応答 `GET /og/work?id=`（http.ts → works.ogSummary）。
 * 105A: 認証なしで制作物の題名を返す。無い ID は 404
 */
describe("Convex: GET /og/work（リンクのプレビューの題名）", () => {
  it("制作物は題名だけ返し、無い ID は 404", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const base = {
      purpose: "内部向けの説明",
      category: "SNS",
      mediaType: "sns" as const,
      year: 100,
      creatorIds: [cast.creator.id],
      approverId: cast.approver.id,
    };
    const normal = await cast.manager.as.mutation(api.works.create, {
      ...base,
      title: "公式 Instagram 開催告知",
    });
    const restricted = await cast.manager.as.mutation(api.works.create, {
      ...base,
      title: "非公開の企画",
    });

    const ok = await t.fetch(`/og/work?id=${normal}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("max-age=300");
    expect(await ok.json()).toEqual({ title: "公式 Instagram 開催告知" });

    const restrictedRes = await t.fetch(`/og/work?id=${restricted}`);
    expect(restrictedRes.status).toBe(200);
    expect(await restrictedRes.json()).toEqual({ title: "非公開の企画" });
    expect((await t.fetch(`/og/work?id=not-an-id`)).status).toBe(404);
    expect((await t.fetch(`/og/work`)).status).toBe(404);
  });
});
