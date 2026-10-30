import { describe, expect, it } from "vite-plus/test";
import { createWork, importWorks, updateWork } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedLegacyCreatorApproverWork, seedWork } from "../testing/scenario.ts";

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

  it("制作者だけの変更は、現在の制作者と主管ができる。校了者だけの変更はできない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const creatorsOnly = { creatorIds: [principals.reviewer.userId] };
    await expect(
      updateWork(ctx, principals.creator, { workId: work.id, patch: creatorsOnly }),
    ).resolves.toMatchObject({ creatorIds: [principals.reviewer.userId] });
    await expect(
      updateWork(ctx, principals.approver, { workId: work.id, patch: creatorsOnly }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      updateWork(ctx, principals.creator, { workId: work.id, patch: { title: "改題" } }),
    ).rejects.toMatchObject({ code: "forbidden" });
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

describe("制作者は校了者になれない（利用者決定 2026-10-18）", () => {
  const overlap = invalid("approverIds", "creator_is_approver");
  const creator = principals.creator.userId;
  const approver = principals.approver.userId;

  it("登録: 制作者を校了者に含めると拒否される（保存されない）", async () => {
    const ctx = createInMemoryContext();
    const reg = principals.sysadmin;
    await expect(createWork(ctx, reg, { ...input, approverId: creator })).rejects.toThrow(overlap);
    await expect(
      createWork(ctx, reg, { ...input, approverIds: [approver, creator], approvalQuorum: 2 }),
    ).rejects.toThrow(overlap);
    expect(ctx.state.works.all()).toHaveLength(0);
  });

  it("変更（一覧の表のセルも同じ updateWork）: 校了者に制作者を入れる・制作者に校了者を入れる変更は拒否され、版も進まない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const edit = (patch: Parameters<typeof updateWork>[2]["patch"]) =>
      updateWork(ctx, principals.manager, { workId: work.id, patch });
    await expect(edit({ approverIds: [creator] })).rejects.toThrow(overlap);
    await expect(edit({ approverId: creator })).rejects.toThrow(overlap);
    await expect(edit({ creatorIds: [creator, approver] })).rejects.toThrow(overlap);
    expect(await ctx.works.findById(work.id)).toMatchObject({ approverId: approver, version: 1 });
  });

  it("一括登録: 制作者でもある校了者の行は何件目かを添えて拒否する（全体の取り消しは Convex の 1 トランザクション）", async () => {
    const ctx = createInMemoryContext();
    const row = {
      ...importInput,
      managerIds: [],
      confidentiality: "normal" as const,
      notationCategories: [],
      productionTeamIds: [],
    };
    await expect(
      importWorks(ctx, principals.sysadmin, {
        rows: [row, { ...row, approverIds: [approver, creator] }],
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: "work_import_invalid",
        details: expect.objectContaining({
          index: 1,
          cause: "work_invalid",
          field: "approverIds",
          causeReason: "creator_is_approver",
        }),
      }),
    );
  });

  it("決定前に保存された行（制作者＝校了者）は読めて、ほかの項目の変更は通り、重なりを解く変更も通る", async () => {
    const ctx = createInMemoryContext();
    const legacy = await seedLegacyCreatorApproverWork(ctx);
    const edit = (patch: Parameters<typeof updateWork>[2]["patch"]) =>
      updateWork(ctx, principals.manager, { workId: legacy.id, patch });
    expect(await ctx.works.findById(legacy.id)).toMatchObject({
      creatorIds: [approver],
      approverId: approver,
    });
    expect(await edit({ title: "題名だけ変える" })).toMatchObject({
      title: "題名だけ変える",
      approverId: approver,
    });
    const fixed = await edit({ approverIds: [principals.reviewer.userId] });
    expect(fixed).toMatchObject({ approverId: principals.reviewer.userId });
  });
});
