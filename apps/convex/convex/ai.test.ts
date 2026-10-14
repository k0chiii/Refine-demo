import { api } from "./_generated/api";
import { describe, expect, it } from "vite-plus/test";
import { createCast, createHarness } from "../test/harness";
import { setupWork } from "../test/flows";

describe("Convex 統合: AI 校正（任意）", () => {
  it("API キーが無ければ使えず、外部には何も送らない（理由を返す）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const s = await cast.creator.as.query(api.ai.status, { workId });
    expect(s.available).toBe(false);
    expect(s.reason).toMatch(/設定されていません/);
    const r = await cast.creator.as.action(api.ai.proofread, { workId, text: "5月祭" });
    expect(r.blocked).toMatch(/設定されていません/);
    expect(r.candidates).toEqual([]);
    await expect(
      cast.stranger.as.action(api.ai.proofread, { workId, text: "x" }),
    ).rejects.toThrow();
  });
});
