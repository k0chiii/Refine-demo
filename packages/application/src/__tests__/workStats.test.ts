import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { finalizeWork } from "../usecases/approvals.ts";
import { decideThread, postComment } from "../usecases/comments.ts";
import { exportWorkStats } from "../usecases/workStats.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const { creator, reviewer, manager, sysadmin, approver } = principals;
void manager;

describe("制作物ごとの集計（A-4）", () => {
  it("システム管理者だけ。局で絞ると配下の担当の制作物も入る", async () => {
    const ctx = createInMemoryContext();
    await seedWork(ctx, { title: "EVE 企画ポスター" });
    const pr = await ctx.teams.insert({
      name: "広報局",
      kind: "bureau",
      order: 1,
      updatedAt: 0,
      updatedBy: "a",
    });
    const design = await ctx.teams.insert({
      name: "デザイン担当",
      kind: "team",
      parentId: pr.id,
      order: 1,
      updatedAt: 0,
      updatedBy: "a",
    });
    const ga = await ctx.teams.insert({
      name: "総務局",
      kind: "bureau",
      order: 2,
      updatedAt: 0,
      updatedBy: "a",
    });
    const designed = await seedWork(ctx, {
      title: "パンフレット",
      ownerTeamId: design.id,
      productionTeamIds: [design.id],
    });
    const revision = await submitRevision(ctx, designed.id);
    await grantWorkPermission(ctx, sysadmin, {
      workId: designed.id,
      principalType: "user",
      principalId: reviewer.userId,
      permission: "review",
    });
    const c = await postComment(ctx, reviewer, {
      revisionId: revision.id,
      body: "誤字",
      kind: "correction",
      severity: "minor",
    });
    await decideThread(ctx, creator, { threadId: c.id, action: "rejected", reason: "意図どおり" });
    ctx.clock.advance(48 * HOUR);
    await finalizeWork(ctx, approver, { workId: designed.id, revisionId: revision.id });

    await expect(exportWorkStats(ctx, creator, {})).rejects.toThrow(code("forbidden"));
    await expect(exportWorkStats(ctx, sysadmin, { teamId: "nope" })).rejects.toThrow(
      code("team_not_found"),
    );
    expect((await exportWorkStats(ctx, sysadmin, {})).map((r) => r.title)).toEqual([
      "EVE 企画ポスター",
      "パンフレット",
    ]);
    expect(await exportWorkStats(ctx, sysadmin, { teamId: ga.id })).toEqual([]);
    const [row] = await exportWorkStats(ctx, sysadmin, { teamId: pr.id });
    expect(row).toMatchObject({
      workId: designed.id,
      ownerTeam: "広報局 › デザイン担当",
      productionTeams: "広報局 › デザイン担当",
      lifecycle: "finalized",
      revisionCount: 1,
      firstSubmittedAt: revision.submittedAt,
      daysToFinalize: 2,
      commentCount: 1,
      commentsPerRevision: "第1版 1",
      rejectedCount: 1,
      decisionReasons: "意図どおり",
    });
  });
});
