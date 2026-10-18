import { describe, expect, it } from "vite-plus/test";
import { createWork, importWorks, updateWork } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork } from "../testing/scenario.ts";

const invalid = (field: string, reason: string) =>
  expect.objectContaining({
    code: "work_invalid",
    details: expect.objectContaining({ field, reason }),
  });

const input = {
  title: "MF100 ポスター",
  purpose: "",
  category: "印刷物",
  mediaType: "pdf" as const,
  year: 100,
  creatorIds: [principals.creator.userId],
  approverId: principals.approver.userId,
};
const importInput = { ...input, approverIds: [principals.approver.userId] };

describe("制作物の登録・変更の不変条件（PR #1 レビュー P2）", () => {
  it("変更で空の名称・制作者なし・空の校了権限者を保存できない（保存されず版も進まない）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const edit = (patch: Parameters<typeof updateWork>[2]["patch"]) =>
      updateWork(ctx, principals.manager, { workId: work.id, patch });
    await expect(edit({ title: "   ", creatorIds: [], approverId: "" })).rejects.toThrow(
      invalid("title", "required"),
    );
    await expect(edit({ creatorIds: [] })).rejects.toThrow(invalid("creatorIds", "required"));
    await expect(edit({ creatorIds: [""] })).rejects.toThrow(invalid("creatorIds", "blank_id"));
    await expect(edit({ approverId: "" })).rejects.toThrow(invalid("approverIds", "required"));
    await expect(edit({ category: " " })).rejects.toThrow(invalid("category", "required"));
    expect(await ctx.works.findById(work.id)).toEqual(work);
  });

  it("変更で名簿にいない人を職責に入れられない。既にいる人はそのまま", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(
      updateWork(ctx, principals.manager, {
        workId: work.id,
        patch: { approverId: "nonexistent-user" },
      }),
    ).rejects.toThrow(invalid("approverIds", "unknown_user"));
    await expect(
      updateWork(ctx, principals.manager, {
        workId: work.id,
        patch: { creatorIds: [principals.creator.userId, "ghost"] },
      }),
    ).rejects.toThrow(invalid("creatorIds", "unknown_user"));
    const next = await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: {
        title: "  新しい名称 ",
        creatorIds: [principals.creator.userId, principals.reviewer.userId],
      },
    });
    expect(next).toMatchObject({
      title: "新しい名称",
      creatorIds: [principals.creator.userId, principals.reviewer.userId],
      version: work.version + 1,
    });
  });

  it("登録でも空の ID・空の校了権限者・名簿にいない人を受け付けない", async () => {
    const ctx = createInMemoryContext();
    const reg = principals.manager;
    await expect(createWork(ctx, reg, { ...input, creatorIds: [""] })).rejects.toThrow(
      invalid("creatorIds", "blank_id"),
    );
    await expect(createWork(ctx, reg, { ...input, approverId: " " })).rejects.toThrow(
      invalid("approverIds", "required"),
    );
    await expect(createWork(ctx, reg, { ...input, title: "" })).rejects.toThrow(
      invalid("title", "required"),
    );
    await expect(
      createWork(ctx, reg, { ...input, approverId: "nonexistent-user" }),
    ).rejects.toThrow(invalid("approverIds", "unknown_user"));
    await expect(createWork(ctx, reg, { ...input, managerIds: ["ghost"] })).rejects.toThrow(
      invalid("managerIds", "unknown_user"),
    );
    expect(ctx.state.works.all()).toHaveLength(0);
  });

  it("一括登録も同じ検証。だめな行があれば何件目かを添えて、何も登録しない", async () => {
    const ctx = createInMemoryContext();
    const row = {
      ...importInput,
      managerIds: [],
      confidentiality: "normal" as const,
      notationCategories: [],
      productionTeamIds: [],
    };
    await expect(
      importWorks(ctx, principals.sysadmin, { rows: [row, { ...row, creatorIds: [""] }] }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: "work_import_invalid",
        details: expect.objectContaining({
          reason: "row_invalid",
          index: 1,
          cause: "work_invalid",
          field: "creatorIds",
          causeReason: "blank_id",
        }),
      }),
    );
    await expect(
      importWorks(ctx, principals.sysadmin, { rows: [{ ...row, approverIds: ["ghost"] }] }),
    ).rejects.toThrow(expect.objectContaining({ code: "work_import_invalid" }));
  });
});
