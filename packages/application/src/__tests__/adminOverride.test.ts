import type { Principal } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { finalizeWork, reopenWork } from "../usecases/approvals.ts";
import { decideThread, postComment } from "../usecases/comments.ts";
import { buildWorksDashboard } from "../usecases/dashboard.ts";
import { setWorkReviewers } from "../usecases/reviewers.ts";
import { updateWork } from "../usecases/works.ts";
import { loadAuthorizedWork } from "../shared.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

// 職責・ACL・所属が無く、Nogiku Access の組織権限も渡されていないシステム管理者
const admin: Principal = { ...principals.sysadmin, orgPermissions: [] };
const stranger: Principal = { ...principals.stranger, orgPermissions: [] };

async function restrictedWork() {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx);
  return { ctx, work };
}

describe("システム管理者はすべての操作権限を持つ（利用者決定 2026-10-30）", () => {
  it("職責・ACL・所属の無い制作物も、委員なら開け一覧にも出る（105A）。管理者も同様", async () => {
    const { ctx, work } = await restrictedWork();
    await expect(loadAuthorizedWork(ctx, admin, work.id, "work.view")).resolves.toBeTruthy();
    await expect(loadAuthorizedWork(ctx, stranger, work.id, "work.view")).resolves.toBeTruthy();
    const listed = async (who: Principal) =>
      (await buildWorksDashboard(ctx, who, [work])).overview.works.map((r) => r.workId);
    expect(await listed(admin)).toEqual([work.id]);
    expect(await listed(stranger)).toEqual([work.id]);
  });

  it("主管でなくても制作物の情報を変えられ、校了者も（approvers:assign が無くても）変えられる。監査に本人が残る", async () => {
    const { ctx, work } = await restrictedWork();
    await updateWork(ctx, admin, {
      workId: work.id,
      patch: { purpose: "管理者が直した用途" },
    });
    await updateWork(ctx, admin, {
      workId: work.id,
      patch: { approverIds: [principals.approver.userId, principals.manager.userId] },
    });
    const after = (await ctx.works.findById(work.id))!;
    expect(after.purpose).toBe("管理者が直した用途");
    expect(after.approverIds).toEqual([principals.approver.userId, principals.manager.userId]);
    expect(
      ctx.state.audit.filter((e) => e.entityId === work.id && e.operation === "update"),
    ).toEqual([
      expect.objectContaining({ actorId: admin.userId }),
      expect.objectContaining({ actorId: admin.userId }),
    ]);
    await expect(
      updateWork(ctx, stranger, { workId: work.id, patch: { purpose: "x" } }),
    ).rejects.toThrow(code("forbidden"));
  });

  it("校正者の名簿を決め、版を提出し、コメントの採否を決められる", async () => {
    const { ctx, work } = await restrictedWork();
    await setWorkReviewers(ctx, admin, {
      workId: work.id,
      reviewerIds: [principals.reviewer.userId],
    });
    expect((await ctx.works.findById(work.id))!.reviewerIds).toEqual([principals.reviewer.userId]);

    const rev = await submitRevision(ctx, work.id, { principal: admin });
    expect(rev.submittedBy).toBe(admin.userId);

    await grantWorkPermission(ctx, admin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    const thread = await postComment(ctx, principals.reviewer, {
      revisionId: rev.id,
      body: "団体名が誤り",
      kind: "correction",
      severity: "minor",
    });
    await decideThread(ctx, admin, { threadId: thread.id, action: "accepted" });
    expect((await ctx.threads.findById(thread.id))!.resolution).toBe("accepted");
    expect(ctx.state.events.filter((e) => e.eventType === "decided")).toEqual([
      expect.objectContaining({ actorId: admin.userId }),
    ]);
  });

  it("校了: 権限の判定は通り、宣言は校了者ごとに数えるので校了者でない管理者は宣言できない。再開はできる", async () => {
    const { ctx, work } = await restrictedWork();
    const rev = await submitRevision(ctx, work.id);
    await expect(finalizeWork(ctx, admin, { workId: work.id, revisionId: rev.id })).rejects.toThrow(
      code("approval_not_approver"),
    );
    await expect(
      finalizeWork(ctx, principals.manager, { workId: work.id, revisionId: rev.id }),
    ).rejects.toThrow(code("forbidden"));

    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id });
    const reopened = await reopenWork(ctx, admin, { workId: work.id, reason: "差し替えのため" });
    expect(reopened.work.lifecycle).toBe("active");
  });

  it("業務の状態の規則は越えない: 校了後は情報を変えられない", async () => {
    const { ctx, work } = await restrictedWork();
    const rev = await submitRevision(ctx, work.id);
    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id });
    await expect(
      updateWork(ctx, admin, { workId: work.id, patch: { purpose: "校了後の変更" } }),
    ).rejects.toThrow(code("work_already_finalized"));
  });
});
