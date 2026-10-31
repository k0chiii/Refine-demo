import { describe, expect, it } from "vite-plus/test";
import { setWorkReviewers } from "../usecases/reviewers.ts";
import { createWork, importWorks, updateWork } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

/** Nogiku Access 接続後（orgPermissions に実際の権限名が入る）の挙動。 */
describe("組織権限（Nogiku Access 連携の拡張点）", () => {
  const nobody = {
    userId: "u_nobody",
    isSystemAdmin: false,
    groupIds: [],
    orgPermissions: [] as string[],
  };
  const registrar = {
    ...nobody,
    userId: "u_registrar",
    orgPermissions: ["works:create", "approvers:assign"],
  };
  const input = {
    title: "x",
    purpose: "",
    category: "印刷物",
    mediaType: "pdf" as const,
    year: 100,
    creatorIds: [principals.creator.userId],
    approverId: principals.approver.userId,
  };
  const csvRow = {
    title: "y",
    year: 100,
    purpose: "",
    category: "印刷物",
    mediaType: "pdf" as const,
    creatorIds: [principals.creator.userId],
    managerIds: [],
    approverIds: [principals.approver.userId],
    notationCategories: [],
    productionTeamIds: [],
  };

  it("works:create と approvers:assign の両方を持つ人だけが制作物を登録できる", async () => {
    const ctx = createInMemoryContext();
    await expect(createWork(ctx, nobody, input)).rejects.toThrow(code("forbidden"));
    await expect(createWork(ctx, registrar, input)).resolves.toMatchObject({
      managerIds: ["u_registrar"],
    });
    // どちらか片方だけでは登録できない（登録は必ず校了者を決める）
    const createOnly = { ...registrar, orgPermissions: ["works:create"] };
    const assignOnly = { ...registrar, orgPermissions: ["approvers:assign"] };
    await expect(createWork(ctx, createOnly, input)).rejects.toThrow(code("forbidden"));
    await expect(createWork(ctx, assignOnly, input)).rejects.toThrow(code("forbidden"));
    // "*"（Nogiku Access 未接続）は両方を持つ
    await expect(
      createWork(ctx, { ...registrar, orgPermissions: ["*"] }, input),
    ).resolves.toBeDefined();
  });

  it("CSV の一括登録も、両方の権限が要る（1 件も登録されない）", async () => {
    const ctx = createInMemoryContext();
    const createOnly = { ...registrar, orgPermissions: ["works:create"] };
    await expect(importWorks(ctx, createOnly, { rows: [csvRow] })).rejects.toThrow(
      code("forbidden"),
    );
    expect(ctx.state.works.all()).toHaveLength(0);
    await expect(importWorks(ctx, registrar, { rows: [csvRow] })).resolves.toHaveLength(1);
  });

  describe("校了者の変更", () => {
    const patchApprovers = {
      approverIds: [principals.approver.userId, principals.reviewer.userId],
      approvalQuorum: 2,
    };
    // 閲覧だけできる人（通常の制作物は委員なら誰でも見られる）。work.edit は無い
    const decider = { ...nobody, userId: "u_decider", orgPermissions: ["approvers:assign"] };
    const editorOnly = { ...principals.manager, orgPermissions: ["works:create"] };

    it("変更には approvers:assign が要る。work.edit があっても無ければ拒否", async () => {
      const ctx = createInMemoryContext();
      const work = await seedWork(ctx);
      await expect(
        updateWork(ctx, editorOnly, { workId: work.id, patch: patchApprovers }),
      ).rejects.toThrow(code("forbidden"));
      await expect(
        updateWork(ctx, editorOnly, {
          workId: work.id,
          patch: { approvalQuorum: 1, approverId: principals.reviewer.userId },
        }),
      ).rejects.toThrow(code("forbidden"));
      expect((await ctx.works.findById(work.id))!.version).toBe(work.version);
    });

    it("approvers:assign があれば work.edit が無くても校了者だけは変えられる。ほかの項目は work.edit のまま", async () => {
      const ctx = createInMemoryContext();
      const work = await seedWork(ctx);
      const updated = await updateWork(ctx, decider, { workId: work.id, patch: patchApprovers });
      expect(updated.approverIds).toEqual(patchApprovers.approverIds);
      expect(updated.approvalQuorum).toBe(2);
      // 校了者以外の項目が混ざると work.edit が要る
      await expect(
        updateWork(ctx, decider, {
          workId: work.id,
          patch: { ...patchApprovers, title: "書き換え" },
        }),
      ).rejects.toThrow(code("forbidden"));
      await expect(
        updateWork(ctx, decider, { workId: work.id, patch: { title: "書き換え" } }),
      ).rejects.toThrow(code("forbidden"));
    });

    it("制作者は校了者になれない規則はそのまま", async () => {
      const ctx = createInMemoryContext();
      const work = await seedWork(ctx);
      await expect(
        updateWork(ctx, decider, {
          workId: work.id,
          patch: { approverIds: [principals.creator.userId] },
        }),
      ).rejects.toThrow(code("work_invalid"));
    });

    it("校了者が変わらない更新（同じ値の送り直し・ほかの項目）は approvers:assign が無くても通る", async () => {
      const ctx = createInMemoryContext();
      const work = await seedWork(ctx);
      const same = await updateWork(ctx, editorOnly, {
        workId: work.id,
        patch: {
          title: "題名だけ変える",
          approverIds: [principals.approver.userId],
          approvalQuorum: 1,
        },
      });
      expect(same.title).toBe("題名だけ変える");
      await expect(
        updateWork(ctx, editorOnly, { workId: work.id, patch: { purpose: "目的" } }),
      ).resolves.toMatchObject({ purpose: "目的" });
    });

    it('"*" は approvers:assign を含む', async () => {
      const ctx = createInMemoryContext();
      const work = await seedWork(ctx);
      const all = { ...nobody, userId: "u_all", orgPermissions: ["*"] };
      await expect(
        updateWork(ctx, all, { workId: work.id, patch: patchApprovers }),
      ).resolves.toMatchObject({ approvalQuorum: 2 });
    });

    it("閲覧できない制作物は、権限があっても存在を漏らさない", async () => {
      const ctx = createInMemoryContext();
      const work = await seedWork(ctx);
      await expect(
        updateWork(ctx, decider, { workId: work.id, patch: patchApprovers }),
      ).rejects.toThrow(code("forbidden"));
    });
  });

  it("reviews:assign を持つ人、または制作者は割当できる。それ以外は不可", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    const assigner = { ...nobody, userId: "u_assigner", orgPermissions: ["reviews:assign"] };
    // 組織権限があっても作品の閲覧権限（職責/ACL）が無ければ存在を漏らさない
    await expect(
      setWorkReviewers(ctx, assigner, {
        workId: rev.workId,
        reviewerIds: ["r"],
      }),
    ).rejects.toThrow(code("forbidden"));
    const creatorNoOrg = { ...principals.creator, orgPermissions: [] as string[] };
    await expect(
      setWorkReviewers(ctx, creatorNoOrg, {
        workId: rev.workId,
        reviewerIds: [principals.reviewer.userId],
      }),
    ).resolves.toMatchObject({ work: { reviewerIds: [principals.reviewer.userId] } });
    const reviewerNoOrg = { ...principals.reviewer, orgPermissions: [] as string[] };
    await ctx.acl.insert({
      workId: work.id,
      principalType: "user",
      principalId: reviewerNoOrg.userId,
      permission: "review",
      grantedBy: "u_sysadmin",
      grantedAt: 0,
    });
    await expect(
      setWorkReviewers(ctx, reviewerNoOrg, {
        workId: rev.workId,
        reviewerIds: ["r2"],
      }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      setWorkReviewers(
        ctx,
        { ...reviewerNoOrg, orgPermissions: ["reviews:assign"] },
        { workId: rev.workId, reviewerIds: [principals.stranger.userId] },
      ),
    ).resolves.toMatchObject({ work: { reviewerIds: [principals.stranger.userId] } });
  });
});
