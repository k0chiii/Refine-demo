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

  it("別の制作物の版と比べる: 両方を見られる人だけ読め、直せるのは表示中（右）の制作物で校正に関わる人", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9), toFake: ["Date"] });
    const t = createHarness();
    const cast = await createCast(t);
    const current = await setupWork(t, cast, { title: "今年のポスター" });
    const otherWork = await setupWork(t, cast, { title: "去年のポスター" });
    const cur = await submitFiles(cast, current, [
      { fileName: "poster.pdf", mimeType: "application/pdf", type: "pdf" },
    ]);
    const oth = await submitFiles(cast, otherWork, [
      { fileName: "last-year.pdf", mimeType: "application/pdf", type: "pdf" },
    ]);
    // 左 = 相手（別の制作物）、右 = 表示中の版
    const args = { leftArtifactId: oth.artifacts[0]!.id, rightArtifactId: cur.artifacts[0]!.id };

    // 相手の版そのものは閲覧権限で読める（revisions.get）。見られない人には存在も返さない
    expect(
      (await cast.reviewer.as.query(api.revisions.get, { revisionId: oth.revisionId })).work,
    ).toMatchObject({ id: otherWork, title: "去年のポスター" });
    await expect(
      cast.stranger.as.query(api.revisions.get, { revisionId: oth.revisionId }),
    ).rejects.toThrow(code("forbidden"));

    // 表示中の制作物だけ見られる人: 相手が見られないので対応も読めない
    await cast.admin.as.mutation(api.acl.grant, {
      workId: current,
      principalType: "user",
      principalId: cast.stranger.id,
      permission: "view",
    });
    await expect(cast.stranger.as.query(api.comparisons.getOverride, args)).rejects.toThrow(
      code("forbidden"),
    );
    // 両方を見られるようになれば読める。閲覧だけの人は直せない
    await cast.admin.as.mutation(api.acl.grant, {
      workId: otherWork,
      principalType: "user",
      principalId: cast.stranger.id,
      permission: "view",
    });
    expect(await cast.stranger.as.query(api.comparisons.getOverride, args)).toBeNull();
    await expect(
      cast.stranger.as.mutation(api.comparisons.saveOverride, {
        ...args,
        pairs: [{ left: 1, right: 1 }],
      }),
    ).rejects.toThrow(code("forbidden"));
    // 表示中の制作物の校正者（相手は閲覧できる）は直せる。保存先の制作物は表示中（右）
    await cast.reviewer.as.mutation(api.comparisons.saveOverride, {
      ...args,
      pairs: [{ left: 2, right: 1 }],
    });
    expect((await cast.stranger.as.query(api.comparisons.getOverride, args))!.pairs).toEqual([
      { left: 2, right: 1 },
    ]);
    const rows = await t.run((ctx) => ctx.db.query("alignmentOverrides").collect());
    expect(rows.map((r) => r.workId)).toEqual([current]);
    vi.useRealTimers();
  });
});
