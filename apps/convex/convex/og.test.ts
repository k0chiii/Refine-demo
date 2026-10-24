import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";

/**
 * リンクのプレビュー（OGP）の公開の応答 `GET /og/work?id=`（http.ts → works.ogSummary）。
 * 認証なしで引けるのは、機密区分が通常の制作物の題名だけ。非公開・取扱注意と無い ID は 404（存在も返さない）
 */
describe("Convex: GET /og/work（リンクのプレビューの題名）", () => {
  it("通常の制作物は題名だけ返し、非公開・無い ID は 404", async () => {
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
      confidentiality: "restricted",
    });

    const ok = await t.fetch(`/og/work?id=${normal}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("max-age=300");
    expect(await ok.json()).toEqual({ title: "公式 Instagram 開催告知" });

    expect((await t.fetch(`/og/work?id=${restricted}`)).status).toBe(404);
    expect((await t.fetch(`/og/work?id=not-an-id`)).status).toBe(404);
    expect((await t.fetch(`/og/work`)).status).toBe(404);
  });
});
