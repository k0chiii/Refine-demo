import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { finalizeWork, reopenWork } from "../usecases/approvals.ts";
import { decideThread, postComment } from "../usecases/comments.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

describe("校了と再開（A-08, A-09, A-10）", () => {
  it("A-08: 重大未解決があると通常校了は拒否。理由付き例外は監査付きで可能", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    await grantWorkPermission(ctx, principals.sysadmin, { workId: work.id, principalType: "user", principalId: principals.reviewer.userId, permission: "review" });
    await postComment(ctx, principals.reviewer, { revisionId: rev.id, body: "団体名が誤り", kind: "correction", severity: "critical" });

    await expect(finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id })).rejects.toThrow(code("approval_blocking_threads_remain"));
    await expect(finalizeWork(ctx, principals.manager, { workId: work.id, revisionId: rev.id, exceptionReason: "x" })).rejects.toThrow(code("forbidden"));

    const { work: finalized, event } = await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id, exceptionReason: "印刷入稿期限。訂正シールで対応" });
    expect(finalized.lifecycle).toBe("finalized");
    expect(finalized.finalRevisionId).toBe(rev.id);
    expect(event.action).toBe("exception_finalized");
    expect(event.exceptionReason).toContain("訂正シール");
    expect(event.requiredChecksSnapshot).toMatchObject({ blockingThreadIds: [expect.any(String)] });
  });

  it("重大指摘を不採用（理由付き）にすれば通常校了できる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    await grantWorkPermission(ctx, principals.sysadmin, { workId: work.id, principalType: "user", principalId: principals.reviewer.userId, permission: "review" });
    const t = await postComment(ctx, principals.reviewer, { revisionId: rev.id, body: "x", kind: "correction", severity: "major" });
    await decideThread(ctx, principals.creator, { threadId: t.id, action: "rejected", reason: "確認済み・正しい表記" });
    const { event } = await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id });
    expect(event.action).toBe("finalized");
  });

  it("A-09: 校了後の版提出・指摘は拒否。理由付き再開で履歴は消えない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id });

    await expect(submitRevision(ctx, work.id)).rejects.toThrow(code("work_already_finalized"));
    await expect(postComment(ctx, principals.creator, { revisionId: rev.id, body: "x", kind: "question", severity: "info" })).rejects.toThrow(code("work_already_finalized"));
    await expect(reopenWork(ctx, principals.approver, { workId: work.id, reason: "  " })).rejects.toThrow(code("approval_reopen_reason_required"));
    await expect(reopenWork(ctx, principals.manager, { workId: work.id, reason: "誤り発見" })).rejects.toThrow(code("forbidden"));

    const { work: reopened } = await reopenWork(ctx, principals.approver, { workId: work.id, reason: "日付の誤りが判明" });
    expect(reopened.lifecycle).toBe("active");
    const events = await ctx.approvals.listByWork(work.id);
    expect(events.map((e) => e.action)).toEqual(["finalized", "reopened"]);
    expect(events[1]?.reason).toBe("日付の誤りが判明");
    // 再開後は次版を提出できる
    ctx.clock.advance(HOUR);
    const r2 = await submitRevision(ctx, work.id);
    expect(r2.sequence).toBe(2);
  });

  it("A-10: 同じ requestId の校了再送は二重校了・二重イベントにならない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    const a = await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id, requestId: "fin-1" });
    const b = await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id, requestId: "fin-1" });
    expect(b.event.createdAt).toBe(a.event.createdAt);
    expect((await ctx.approvals.listByWork(work.id)).length).toBe(1);
    // requestId 無しの再送は「既に校了済み」として拒否される（状態は変わらない）
    await expect(finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id })).rejects.toThrow(code("work_already_finalized"));
  });

  it("自己校了（制作者＝校了者）は暫定で拒否される（D2）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { creatorIds: [principals.approver.userId] });
    const rev = await submitRevision(ctx, work.id, { principal: principals.approver });
    await expect(finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id })).rejects.toThrow(code("approval_self_approval_not_allowed"));
  });
});
