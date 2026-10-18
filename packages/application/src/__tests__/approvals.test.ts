import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import {
  confirmIndependently,
  finalizeWork,
  getConfirmationStatus,
  reopenWork,
} from "../usecases/approvals.ts";
import { decideThread, postComment } from "../usecases/comments.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import {
  HOUR,
  principals,
  seedLegacyCreatorApproverWork,
  seedWork,
  submitRevision,
} from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

describe("校了と再開（A-08, A-09, A-10）", () => {
  it("A-08: 重大未解決があると通常校了は拒否。理由付き例外は監査付きで可能", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.reviewer.userId,
      permission: "review",
    });
    await postComment(ctx, principals.reviewer, {
      revisionId: rev.id,
      body: "団体名が誤り",
      kind: "correction",
      severity: "critical",
    });

    await expect(
      finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id }),
    ).rejects.toThrow(code("approval_blocking_threads_remain"));
    await expect(
      finalizeWork(ctx, principals.manager, {
        workId: work.id,
        revisionId: rev.id,
        exceptionReason: "x",
      }),
    ).rejects.toThrow(code("forbidden"));

    const { work: finalized, event } = await finalizeWork(ctx, principals.approver, {
      workId: work.id,
      revisionId: rev.id,
      exceptionReason: "印刷入稿期限。訂正シールで対応",
    });
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
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.reviewer.userId,
      permission: "review",
    });
    const t = await postComment(ctx, principals.reviewer, {
      revisionId: rev.id,
      body: "x",
      kind: "correction",
      severity: "major",
    });
    await decideThread(ctx, principals.creator, {
      threadId: t.id,
      action: "rejected",
      reason: "確認済み・正しい表記",
    });
    const { event } = await finalizeWork(ctx, principals.approver, {
      workId: work.id,
      revisionId: rev.id,
    });
    expect(event.action).toBe("finalized");
  });

  it("A-09: 校了後の版提出・指摘は拒否。理由付き再開で履歴は消えない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id });

    await expect(submitRevision(ctx, work.id)).rejects.toThrow(code("work_already_finalized"));
    await expect(
      postComment(ctx, principals.creator, {
        revisionId: rev.id,
        body: "x",
        kind: "question",
        severity: "info",
      }),
    ).rejects.toThrow(code("work_already_finalized"));
    await expect(
      reopenWork(ctx, principals.approver, { workId: work.id, reason: "  " }),
    ).rejects.toThrow(code("approval_reopen_reason_required"));
    await expect(
      reopenWork(ctx, principals.manager, { workId: work.id, reason: "誤り発見" }),
    ).rejects.toThrow(code("forbidden"));

    const { work: reopened } = await reopenWork(ctx, principals.approver, {
      workId: work.id,
      reason: "日付の誤りが判明",
    });
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
    const a = await finalizeWork(ctx, principals.approver, {
      workId: work.id,
      revisionId: rev.id,
      requestId: "fin-1",
    });
    const b = await finalizeWork(ctx, principals.approver, {
      workId: work.id,
      revisionId: rev.id,
      requestId: "fin-1",
    });
    expect(b.event.createdAt).toBe(a.event.createdAt);
    expect((await ctx.approvals.listByWork(work.id)).length).toBe(1);
    // requestId 無しの再送は「既に校了済み」として拒否される（状態は変わらない）
    await expect(
      finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id }),
    ).rejects.toThrow(code("work_already_finalized"));
  });

  it("決定前に保存された自己校了（制作者＝校了者）の行は、読めて、暫定で独立確認なしでは校了できない（D2）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedLegacyCreatorApproverWork(ctx);
    const rev = await submitRevision(ctx, work.id, { principal: principals.approver });
    await expect(
      finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev.id }),
    ).rejects.toThrow(code("approval_self_approval_not_allowed"));
  });
});

describe("独立確認（D2。決定前に保存された自己校了の行だけが対象）", () => {
  async function selfApprovedWork() {
    const ctx = createInMemoryContext();
    const work = await seedLegacyCreatorApproverWork(ctx);
    const rev = await submitRevision(ctx, work.id, { principal: principals.approver });
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.reviewer.userId,
      permission: "review",
    });
    return { ctx, work, rev };
  }

  it("申告した確認者 ID（存在しない人）では自己校了できない", async () => {
    const { ctx, work, rev } = await selfApprovedWork();
    await expect(
      finalizeWork(ctx, principals.approver, {
        workId: work.id,
        revisionId: rev.id,
        ...({ independentConfirmerId: "nonexistent-user" } as object),
      }),
    ).rejects.toThrow(code("approval_self_approval_not_allowed"));
    expect((await ctx.works.findById(work.id))?.lifecycle).toBe("active");
  });

  it("確認者本人の操作で記録した確認があれば校了でき、証跡が校了の記録に残る", async () => {
    const { ctx, work, rev } = await selfApprovedWork();
    // 制作者＝校了権限者は自分では確認できない。関与していない人は存在も分からない
    await expect(
      confirmIndependently(ctx, principals.approver, { revisionId: rev.id }),
    ).rejects.toThrow(code("approval_confirmer_not_independent"));
    await expect(
      confirmIndependently(ctx, principals.stranger, { revisionId: rev.id }),
    ).rejects.toThrow(code("forbidden"));

    const before = await getConfirmationStatus(ctx, principals.reviewer, { workId: work.id });
    expect(before).toMatchObject({ required: true, valid: null, canConfirm: true });
    expect(
      (await getConfirmationStatus(ctx, principals.approver, { workId: work.id })).canConfirm,
    ).toBe(false);

    const c = await confirmIndependently(ctx, principals.reviewer, {
      revisionId: rev.id,
      note: "  全ページ確認  ",
    });
    expect(c).toMatchObject({
      workId: work.id,
      revisionId: rev.id,
      confirmerId: principals.reviewer.userId,
      note: "全ページ確認",
    });
    // 同じ人の確認し直しは 1 件のまま
    expect((await confirmIndependently(ctx, principals.reviewer, { revisionId: rev.id })).id).toBe(
      c.id,
    );
    expect(ctx.state.confirmations.all()).toHaveLength(1);
    expect(ctx.state.audit.some((a) => a.operation === "independent_confirmation")).toBe(true);
    expect(
      await getConfirmationStatus(ctx, principals.approver, { workId: work.id }),
    ).toMatchObject({ required: true, valid: { id: c.id }, canConfirm: false });

    const { event } = await finalizeWork(ctx, principals.approver, {
      workId: work.id,
      revisionId: rev.id,
    });
    expect(event.action).toBe("finalized");
    expect(event.requiredChecksSnapshot).toMatchObject({
      selfApproval: true,
      independentConfirmation: { id: c.id, confirmerId: principals.reviewer.userId },
    });
  });

  it("確認は版ごと。新しい版・権限の取り消し・再開の後は確認し直す", async () => {
    const { ctx, work, rev } = await selfApprovedWork();
    await confirmIndependently(ctx, principals.reviewer, { revisionId: rev.id });
    // 新しい版を出すと、前の版の確認では校了できない
    ctx.clock.advance(HOUR);
    const rev2 = await submitRevision(ctx, work.id, { principal: principals.approver });
    await expect(
      finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev2.id }),
    ).rejects.toThrow(code("approval_self_approval_not_allowed"));
    // 前の版への確認はもう記録できない
    await expect(
      confirmIndependently(ctx, principals.manager, { revisionId: rev.id }),
    ).rejects.toThrow(code("approval_revision_not_candidate"));

    // 閲覧権限を取り消された人の確認は数えない
    await confirmIndependently(ctx, principals.reviewer, { revisionId: rev2.id });
    const grant = ctx.state.grants.find((g) => g.principalId === principals.reviewer.userId)!;
    await ctx.acl.update({ ...grant, revokedAt: ctx.clock.now(), revokedBy: "u_sysadmin" });
    await expect(
      finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev2.id }),
    ).rejects.toThrow(code("approval_self_approval_not_allowed"));

    // 主管の確認で校了 → 再開すると、同じ版でも確認し直す
    await confirmIndependently(ctx, principals.manager, { revisionId: rev2.id });
    await finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev2.id });
    ctx.clock.advance(HOUR);
    await reopenWork(ctx, principals.approver, { workId: work.id, reason: "誤字が見つかった" });
    await expect(
      finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev2.id }),
    ).rejects.toThrow(code("approval_self_approval_not_allowed"));
    ctx.clock.advance(HOUR);
    await confirmIndependently(ctx, principals.manager, { revisionId: rev2.id });
    await expect(
      finalizeWork(ctx, principals.approver, { workId: work.id, revisionId: rev2.id }),
    ).resolves.toMatchObject({ event: { action: "finalized" } });
  });

  it("自己校了でない制作物では独立確認は要らない（記録もしない）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    await expect(
      confirmIndependently(ctx, principals.manager, { revisionId: rev.id }),
    ).rejects.toThrow(code("approval_confirmation_not_needed"));
    expect(await getConfirmationStatus(ctx, principals.manager, { workId: work.id })).toMatchObject(
      { required: false, canConfirm: false },
    );
  });
});
