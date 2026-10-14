import { api } from "./_generated/api";
import { describe, expect, it } from "vite-plus/test";
import { createCast, createHarness, HOUR } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";
import { vi } from "vite-plus/test";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

describe("Convex 統合: 版比較の手動ページ対応", () => {
  it("校正に関わる人が保存し、同じ添付の組で再利用できる。権限の無い人には返さない。不正な組は拒否", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9), toFake: ["Date"] });
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const r1 = await submitFiles(cast, workId, [
      { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" },
    ]);
    vi.setSystemTime(Date.now() + HOUR);
    const r2 = await submitFiles(cast, workId, [
      { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" },
    ]);
    const args = { leftArtifactId: r1.artifacts[0]!.id, rightArtifactId: r2.artifacts[0]!.id };

    expect(await cast.reviewer.as.query(api.comparisons.getOverride, args)).toBeNull();
    await cast.reviewer.as.mutation(api.comparisons.saveOverride, {
      ...args,
      pairs: [
        { left: 2, right: 3 },
        { left: null, right: 2 },
      ],
    });
    expect((await cast.creator.as.query(api.comparisons.getOverride, args))!.pairs).toEqual([
      { left: 2, right: 3 },
      { left: null, right: 2 },
    ]);
    await expect(cast.stranger.as.query(api.comparisons.getOverride, args)).rejects.toThrow(
      code("forbidden"),
    );
    await expect(
      cast.reviewer.as.mutation(api.comparisons.saveOverride, {
        ...args,
        pairs: [
          { left: 1, right: 1 },
          { left: 1, right: 2 },
        ],
      }),
    ).rejects.toThrow(code("forbidden"));
    vi.useRealTimers();
  });
});
