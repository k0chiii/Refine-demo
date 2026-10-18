import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import { setupWork } from "../test/flows";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

describe("Convex 統合: 版を提出・自分だけのダッシュボード・一括登録", () => {
  it("版を提出する制作物は制作者にだけ出て、ダッシュボードの「提出する」と一致する", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const targets = await cast.creator.as.query(api.home.submitTargets, {});
    expect(targets.map((x) => x.workId)).toEqual([workId]);
    expect(await cast.reviewer.as.query(api.home.submitTargets, {})).toEqual([]);
    const dash = await cast.creator.as.query(api.dashboard.get, {});
    expect(dash.mine.submit.map((i) => i.workId)).toEqual([workId]);
    expect(dash.layout[0]!.id).toBe("submit");
  });

  it("構成・ピン留め・最近開いた制作物はアカウントごとに保存される", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { confidentiality: "restricted" });
    await cast.reviewer.as.mutation(api.home.saveLayout, {
      widgets: [
        { id: "recent", visible: true, limit: 3 },
        { id: "unknown", visible: true, limit: 5 },
      ],
    });
    await cast.reviewer.as.mutation(api.home.setPinned, { workId, pinned: true });
    await cast.reviewer.as.mutation(api.home.recordOpened, { workId });
    await cast.reviewer.as.mutation(api.home.recordOpened, { workId });
    expect(await cast.reviewer.as.query(api.home.pinned, { workId })).toBe(true);
    const d = await cast.reviewer.as.query(api.dashboard.get, {});
    expect(d.customized).toBe(true);
    expect(d.layout[0]).toEqual({ id: "recent", visible: true, limit: 3 });
    expect(d.pinned.map((i) => i.workId)).toEqual([workId]);
    expect(d.recent).toHaveLength(1);
    // ほかの人には影響しない。見られない制作物はピン留めできない
    const other = await cast.creator.as.query(api.dashboard.get, {});
    expect(other.customized).toBe(false);
    expect(other.pinned).toHaveLength(0);
    await expect(
      cast.stranger.as.mutation(api.home.setPinned, { workId, pinned: true }),
    ).rejects.toThrow(code("forbidden"));
    await cast.reviewer.as.mutation(api.home.resetLayout, {});
    expect((await cast.reviewer.as.query(api.dashboard.get, {})).customized).toBe(false);
  });

  it("一括登録: 担当者を照合して、まとめて登録し、一括の監査を残す", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const directory = await cast.admin.as.query(api.works.importDirectory, {
      keys: ["creator@example.invalid", "approver", "nobody"],
    });
    expect(directory.map((u) => u.name).sort()).toEqual(["approver", "creator"]);
    const byName = Object.fromEntries(directory.map((u) => [u.name, u.id as Id<"users">]));
    const ids = await cast.admin.as.mutation(api.works.importBatch, {
      rows: ["一", "二"].map((title) => ({
        title,
        year: 100,
        purpose: "",
        category: "印刷物",
        mediaType: "pdf" as const,
        creatorIds: [byName.creator!],
        managerIds: [],
        approverIds: [byName.approver!],
        confidentiality: "normal" as const,
        notationCategories: [],
      })),
      source: "works.csv",
    });
    expect(ids).toHaveLength(2);
    expect(
      (await cast.creator.as.query(api.home.submitTargets, {})).map((x) => x.workTitle),
    ).toEqual(["一", "二"]);
    const audit = await cast.admin.as.query(api.admin.auditLog, {});
    expect(audit.some((e) => e.operation === "bulk_import")).toBe(true);
  });
});
