import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

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
  });

  it("ピン留めはアカウントごとに保存される", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    await cast.reviewer.as.mutation(api.home.setPinned, { workId, pinned: true });
    expect(await cast.reviewer.as.query(api.home.pinned, { workId })).toBe(true);
    const d = await cast.reviewer.as.query(api.dashboard.get, {});
    expect(d.pinned.map((i) => i.workId)).toEqual([workId]);
    // ほかの人には影響しない。見られない制作物はピン留めできない
    const other = await cast.creator.as.query(api.dashboard.get, {});
    expect(other.pinned).toHaveLength(0);
    await expect(
      cast.stranger.as.mutation(api.home.setPinned, { workId, pinned: true }),
    ).rejects.toThrow(code("forbidden"));
  });

  it("ピン留めした制作物は校正の入口のピン留めに出て、版提出の通知もピン留めした人に届く", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];
    await submitFiles(cast, workId, pdf);
    await cast.stranger.as.mutation(api.home.setPinned, { workId, pinned: true });
    const { revisionId } = await submitFiles(cast, workId, pdf);
    const got = (await cast.stranger.as.query(api.notifications.list, {})).filter(
      (n) => n.kind === "revision_submitted",
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ workId, revisionId });
    const other = await cast.reviewer.as.query(api.notifications.list, {});
    expect(other.filter((n) => n.kind === "revision_submitted")).toHaveLength(0);

    const check = await cast.stranger.as.query(api.dashboard.check, {});
    expect(check.pinned.map((i) => [i.workId, i.revisionId])).toEqual([[workId, revisionId]]);
    expect((await cast.reviewer.as.query(api.dashboard.check, {})).pinned).toEqual([]);
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
