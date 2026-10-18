import { approvalProgressOf, approvalSetupOf } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import {
  confirmIndependently,
  finalizeWork,
  getConfirmationStatus,
  reopenWork,
} from "../usecases/approvals.ts";
import { buildDashboard } from "../usecases/dashboard.ts";
import { updateWork } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const invalid = (field: string, reason: string) =>
  expect.objectContaining({
    code: "work_invalid",
    details: expect.objectContaining({ field, reason }),
  });

const a1 = principals.approver;
const a2 = principals.reviewer;
const a3 = principals.stranger;

/** 校了者 3 人（a1・a2・a3）で、既定は 2 人で校了 */
async function setup(over: Parameters<typeof seedWork>[1] = {}) {
  const ctx = createInMemoryContext();
  const work = await seedWork(ctx, {
    approverIds: [a1.userId, a2.userId, a3.userId],
    approvalQuorum: 2,
    ...over,
  });
  const revision = await submitRevision(ctx, work.id);
  return { ctx, work, revision };
}

const declare = (
  ctx: Awaited<ReturnType<typeof setup>>["ctx"],
  who: typeof a1,
  workId: string,
  revisionId: string,
) => finalizeWork(ctx, who, { workId, revisionId });

describe("校了者が複数のときの校了（利用者決定 2026-10-18）", () => {
  it("登録: approverId は先頭、approverIds と人数が保存される。古い入力（approverId だけ）は 1 人・人数 1", async () => {
    const { work } = await setup();
    expect(work).toMatchObject({
      approverId: a1.userId,
      approverIds: [a1.userId, a2.userId, a3.userId],
      approvalQuorum: 2,
    });
    const legacy = await seedWork(createInMemoryContext());
    expect(approvalSetupOf(legacy)).toEqual({ approverIds: [a1.userId], quorum: 1 });
  });

  it("人数に届くまでは宣言の記録だけ。届いたら校了になる", async () => {
    const { ctx, work, revision } = await setup();
    const first = await declare(ctx, a1, work.id, revision.id);
    expect(first).toMatchObject({ finalized: false, declared: 1, quorum: 2 });
    expect(first.event.action).toBe("declared");
    expect((await ctx.works.findById(work.id))!.lifecycle).toBe("active");

    const second = await declare(ctx, a3, work.id, revision.id);
    expect(second).toMatchObject({ finalized: true, declared: 2 });
    expect(second.event.action).toBe("finalized");
    const stored = (await ctx.works.findById(work.id))!;
    expect(stored).toMatchObject({ lifecycle: "finalized", finalRevisionId: revision.id });
    expect((await ctx.approvals.listByWork(work.id)).map((e) => e.action)).toEqual([
      "declared",
      "finalized",
    ]);
    expect(
      ctx.state.audit.filter((a) => a.operation === "approval_declared").map((a) => a.actorId),
    ).toEqual([a1.userId]);
  });

  it("同じ校了者の宣言は 2 回数えない。校了者でない人は宣言できない", async () => {
    const { ctx, work, revision } = await setup();
    await declare(ctx, a1, work.id, revision.id);
    await expect(declare(ctx, a1, work.id, revision.id)).rejects.toThrow(
      code("approval_already_declared"),
    );
    await expect(declare(ctx, principals.manager, work.id, revision.id)).rejects.toThrow(
      code("forbidden"),
    );
    expect((await ctx.works.findById(work.id))!.lifecycle).toBe("active");
    const progress = approvalProgressOf(
      (await ctx.works.findById(work.id))!,
      await ctx.approvals.listByWork(work.id),
      await ctx.revisions.listByWork(work.id),
    );
    expect(progress.declaredIds).toEqual([a1.userId]);
  });

  it("人数 1: 校了者のうち誰か 1 人で校了になり、記録は従来どおり校了だけ", async () => {
    const { ctx, work, revision } = await setup({ approvalQuorum: 1 });
    const done = await declare(ctx, a3, work.id, revision.id);
    expect(done).toMatchObject({ finalized: true, declared: 1, quorum: 1 });
    expect((await ctx.approvals.listByWork(work.id)).map((e) => e.action)).toEqual(["finalized"]);
  });

  it("再開すると宣言は数え直し。人数に届いた校了者が再び 1 人ずつ宣言する", async () => {
    const { ctx, work, revision } = await setup();
    await declare(ctx, a1, work.id, revision.id);
    await declare(ctx, a2, work.id, revision.id);
    await reopenWork(ctx, a1, { workId: work.id, reason: "誤りが見つかった" });
    const again = await declare(ctx, a1, work.id, revision.id);
    expect(again.finalized).toBe(false);
    expect((await declare(ctx, a2, work.id, revision.id)).finalized).toBe(true);
  });

  it("例外校了の理由は、人数に届いた校了に引き継がれる", async () => {
    const { ctx, work, revision } = await setup();
    const { postComment } = await import("../usecases/comments.ts");
    const { grantWorkPermission } = await import("../usecases/acl.ts");
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.creator.userId,
      permission: "review",
    });
    await postComment(ctx, principals.creator, {
      revisionId: revision.id,
      body: "x",
      kind: "correction",
      severity: "critical",
    });
    await expect(declare(ctx, a1, work.id, revision.id)).rejects.toThrow(
      code("approval_blocking_threads_remain"),
    );
    await finalizeWork(ctx, a1, {
      workId: work.id,
      revisionId: revision.id,
      exceptionReason: "期限のため",
    });
    const done = await finalizeWork(ctx, a2, {
      workId: work.id,
      revisionId: revision.id,
      exceptionReason: "期限のため",
    });
    expect(done.event.action).toBe("exception_finalized");
  });

  it("校了者の全員が通知の宛先と職責の判定に含まれる", async () => {
    const { ctx, work, revision } = await setup({ approvalQuorum: 1 });
    await declare(ctx, a1, work.id, revision.id);
    const finalized = ctx.state.notifications.all().filter((n) => n.kind === "work_finalized");
    const recipients = new Set(finalized.map((n) => n.recipientId));
    expect(recipients.has(a2.userId)).toBe(true);
    expect(recipients.has(a3.userId)).toBe(true);
    expect(recipients.has(a1.userId)).toBe(false); // 操作した本人には送らない
  });

  it("ホームの「校了待ち」: 宣言した校了者からは消え、まだの校了者には残る", async () => {
    const { ctx, work, revision } = await setup();
    const works = async () => [(await ctx.works.findById(work.id))!];
    const pending = async (who: typeof a1) =>
      (await buildDashboard(ctx, who, await works())).mine.finalize.length;
    expect([await pending(a1), await pending(a2)]).toEqual([1, 1]);
    await declare(ctx, a1, work.id, revision.id);
    expect([await pending(a1), await pending(a2)]).toEqual([0, 1]);
  });
});

describe("制作者が校了者のとき（D2 は校了者ごと）", () => {
  it("制作者である校了者は独立確認が要り、ほかの校了者は要らない", async () => {
    const { ctx, work, revision } = await setup({
      creatorIds: [principals.creator.userId],
      approverIds: [principals.creator.userId, a1.userId],
      approvalQuorum: 2,
    });
    const status = (who: typeof a1) => getConfirmationStatus(ctx, who, { workId: work.id });
    expect(await status(a1)).toMatchObject({ required: true, requiredForMe: false });
    expect(await status(principals.creator)).toMatchObject({ required: true, requiredForMe: true });

    await expect(declare(ctx, principals.creator, work.id, revision.id)).rejects.toThrow(
      code("approval_self_approval_not_allowed"),
    );
    // ほかの校了者は独立確認なしで宣言できる
    expect((await declare(ctx, a1, work.id, revision.id)).finalized).toBe(false);

    // 校了者は独立した確認者になれない。校了者でも制作者でもない人の確認で制作者の宣言が通る
    await expect(confirmIndependently(ctx, a1, { revisionId: revision.id })).rejects.toThrow(
      code("approval_confirmer_not_independent"),
    );
    await confirmIndependently(ctx, principals.manager, { revisionId: revision.id });
    const done = await declare(ctx, principals.creator, work.id, revision.id);
    expect(done).toMatchObject({ finalized: true, declared: 2 });
  });
});

describe("校了者と人数の変更（制作物の更新）", () => {
  it("編集できる人（主管）が校了者と人数を変えられる。人数は 1..校了者の数", async () => {
    const { ctx, work } = await setup();
    const edit = (patch: Parameters<typeof updateWork>[2]["patch"]) =>
      updateWork(ctx, principals.manager, { workId: work.id, patch });
    await expect(edit({ approvalQuorum: 4 })).rejects.toThrow(
      invalid("approvalQuorum", "out_of_range"),
    );
    await expect(edit({ approverIds: [] })).rejects.toThrow(invalid("approverIds", "required"));
    await expect(edit({ approverIds: [a1.userId, "ghost"] })).rejects.toThrow(
      invalid("approverIds", "unknown_user"),
    );
    const next = await edit({ approverIds: [a2.userId, a1.userId], approvalQuorum: 2 });
    expect(next).toMatchObject({ approverId: a2.userId, approverIds: [a2.userId, a1.userId] });
    const one = await edit({ approverIds: [a3.userId] });
    expect(approvalSetupOf(one)).toEqual({ approverIds: [a3.userId], quorum: 1 });
    await expect(
      updateWork(ctx, principals.creator, { workId: work.id, patch: { approvalQuorum: 1 } }),
    ).rejects.toThrow(code("forbidden"));
  });

  it("外れた校了者の宣言は数えず、新しい校了者が加われば進める", async () => {
    const { ctx, work, revision } = await setup();
    await declare(ctx, a1, work.id, revision.id);
    await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { approverIds: [a2.userId, a3.userId], approvalQuorum: 2 },
    });
    await expect(declare(ctx, a1, work.id, revision.id)).rejects.toThrow(code("forbidden"));
    expect((await declare(ctx, a2, work.id, revision.id)).finalized).toBe(false);
  });

  it("人数を減らして、すでに届いているとき、残りの校了者の宣言で校了できる", async () => {
    const { ctx, work, revision } = await setup();
    await declare(ctx, a1, work.id, revision.id);
    await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { approverIds: [a1.userId, a2.userId], approvalQuorum: 1 },
    });
    // a1 はすでに宣言済みで、人数 1 に届いている。a2 が宣言すれば校了に進む
    expect((await declare(ctx, a2, work.id, revision.id)).finalized).toBe(true);
  });
});
