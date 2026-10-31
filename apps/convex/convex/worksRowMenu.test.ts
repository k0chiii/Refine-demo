import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";

/**
 * 制作物一覧の行メニュー（WorkRowMenu）が読む `canEdit`（works.listMine）。
 * 主管（work.edit の職責）とシステム管理者（職責が無くても。利用者決定 2026-10-30）だけ true。制作者・校了者は false。
 * 中止した制作物は編集できる（updateWork と同じ）が、
 * 校了済みは false（校了後の更新は updateWork が拒む）。
 */
describe("Convex: works.listMine の canEdit（一覧の行メニュー）", () => {
  it("主管とシステム管理者が編集できる（管理者は職責の無い非公開の制作物でも）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = (await cast.manager.as.mutation(api.works.create, {
      title: "公式 Instagram 開催告知",
      purpose: "",
      category: "SNS",
      mediaType: "sns",
      year: 100,
      creatorIds: [cast.creator.id],
      approverId: cast.approver.id,
      confidentiality: "restricted",
    })) as Id<"works">;
    const canEdit = async (who: (typeof cast)[keyof typeof cast]) =>
      (await who.as.query(api.works.listMine, {})).find((w) => w.id === workId)?.canEdit;
    expect(await canEdit(cast.manager)).toBe(true);
    expect(await canEdit(cast.creator)).toBe(false);
    expect(await canEdit(cast.approver)).toBe(false);
    expect(await canEdit(cast.admin)).toBe(true);
  });

  it("中止した制作物は編集できる（再開のため）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = (await cast.manager.as.mutation(api.works.create, {
      title: "EVE 企画ポスター",
      purpose: "",
      category: "印刷物",
      mediaType: "pdf",
      year: 100,
      creatorIds: [cast.creator.id],
      approverId: cast.approver.id,
    })) as Id<"works">;
    await cast.manager.as.mutation(api.works.changeLifecycle, { workId, to: "cancelled" });
    const rows = await cast.manager.as.query(api.works.listMine, {});
    expect(rows.find((w) => w.id === workId)?.canEdit).toBe(true);
  });

  it("統括と校了する人が制作者だけを変更できる（制作者本人は不可）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = (await cast.manager.as.mutation(api.works.create, {
      title: "表紙",
      purpose: "",
      category: "印刷物",
      mediaType: "pdf",
      year: 100,
      creatorIds: [cast.creator.id],
      approverId: cast.approver.id,
    })) as Id<"works">;
    const flags = async (who: (typeof cast)[keyof typeof cast]) =>
      (await who.as.query(api.works.listMine, {})).find((w) => w.id === workId);
    expect(await flags(cast.manager)).toMatchObject({
      canEdit: true,
      canTransferCreators: true,
    });
    expect(await flags(cast.approver)).toMatchObject({
      canEdit: false,
      canTransferCreators: true,
    });
    expect(await flags(cast.creator)).toMatchObject({
      canEdit: false,
      canTransferCreators: false,
    });
    await cast.approver.as.mutation(api.works.update, {
      workId,
      patch: { creatorIds: [cast.reviewer.id] },
    });
  });
});
