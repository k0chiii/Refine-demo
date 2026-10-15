import { describe, expect, it } from "vite-plus/test";
import { createWork } from "../usecases/works.ts";
import { assignReviewers } from "../usecases/reviews.ts";
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
  const registrar = { ...nobody, userId: "u_registrar", orgPermissions: ["works:create"] };

  it("works:create を持つ人だけが制作物を登録できる", async () => {
    const ctx = createInMemoryContext();
    const input = {
      title: "x",
      purpose: "",
      category: "印刷物",
      mediaType: "pdf" as const,
      year: 100,
      creatorIds: [principals.creator.userId],
      approverId: principals.approver.userId,
    };
    await expect(createWork(ctx, nobody, input)).rejects.toThrow(code("forbidden"));
    await expect(createWork(ctx, registrar, input)).resolves.toMatchObject({
      managerIds: ["u_registrar"],
    });
  });

  it("reviews:assign を持つ人、または制作者は割当できる。それ以外は不可", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    const assigner = { ...nobody, userId: "u_assigner", orgPermissions: ["reviews:assign"] };
    // 組織権限があっても作品の閲覧権限（職責/ACL）が無ければ存在を漏らさない
    await expect(
      assignReviewers(ctx, assigner, {
        revisionId: rev.id,
        reviewerIds: ["r"],
        reviewType: "general",
      }),
    ).rejects.toThrow(code("forbidden"));
    const creatorNoOrg = { ...principals.creator, orgPermissions: [] as string[] };
    await expect(
      assignReviewers(ctx, creatorNoOrg, {
        revisionId: rev.id,
        reviewerIds: ["r"],
        reviewType: "general",
      }),
    ).resolves.toHaveLength(1);
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
      assignReviewers(ctx, reviewerNoOrg, {
        revisionId: rev.id,
        reviewerIds: ["r2"],
        reviewType: "general",
      }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      assignReviewers(
        ctx,
        { ...reviewerNoOrg, orgPermissions: ["reviews:assign"] },
        { revisionId: rev.id, reviewerIds: ["r2"], reviewType: "general" },
      ),
    ).resolves.toHaveLength(1);
  });
});
