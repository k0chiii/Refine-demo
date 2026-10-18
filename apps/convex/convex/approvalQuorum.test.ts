import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import { submitFiles } from "../test/flows";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

/**
 * 校了者が複数・校了とみなす人数（利用者決定 2026-10-18）。保存の形は後方互換: approverId は先頭の 1 人、
 * approverIds・approvalQuorum は任意（古い行は [approverId]・人数 1 と読む。移行しない）。
 */
describe("Convex 統合: 複数の校了者と校了とみなす人数", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(quorum = 2) {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = (await cast.manager.as.mutation(api.works.create, {
      title: "複数校了のポスター",
      purpose: "",
      category: "印刷物",
      mediaType: "pdf",
      year: 100,
      creatorIds: [cast.creator.id],
      approverIds: [cast.approver.id, cast.reviewer.id, cast.stranger.id],
      approvalQuorum: quorum,
    })) as Id<"works">;
    const { revisionId } = await submitFiles(cast, workId, [
      { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" },
    ]);
    return { t, cast, workId, revisionId };
  }

  it("保存: approverId は先頭、全員と人数が保存され、職責の派生テーブルに全員が入る", async () => {
    const { t, cast, workId } = await setup();
    const doc = await t.run((ctx) => ctx.db.get("works", workId));
    expect(doc).toMatchObject({
      approverId: cast.approver.id,
      approverIds: [cast.approver.id, cast.reviewer.id, cast.stranger.id],
      approvalQuorum: 2,
    });
    const roles = await t.run((ctx) =>
      ctx.db
        .query("workRoles")
        .withIndex("by_work", (q) => q.eq("workId", workId))
        .collect(),
    );
    expect(
      roles
        .filter((r) => r.role === "approver")
        .map((r) => r.userId)
        .sort(),
    ).toEqual([cast.approver.id, cast.reviewer.id, cast.stranger.id].sort());

    // 校了者を変えると派生テーブルも作り直す
    await cast.manager.as.mutation(api.works.update, {
      workId,
      patch: { approverIds: [cast.reviewer.id], approvalQuorum: 1 },
    });
    const after = await t.run((ctx) =>
      ctx.db
        .query("workRoles")
        .withIndex("by_work", (q) => q.eq("workId", workId))
        .collect(),
    );
    expect(after.filter((r) => r.role === "approver").map((r) => r.userId)).toEqual([
      cast.reviewer.id,
    ]);
    expect((await t.run((ctx) => ctx.db.get("works", workId)))!.approverId).toBe(cast.reviewer.id);
  });

  it("人数に届くまで宣言の記録だけ。works.get は誰が宣言したかと進み具合を返す", async () => {
    const { cast, workId, revisionId } = await setup();
    const first = await cast.approver.as.mutation(api.approvals.finalize, { workId, revisionId });
    expect(first).toMatchObject({ finalized: false, declared: 1, quorum: 2 });
    const view = await cast.reviewer.as.query(api.works.get, { workId });
    expect(view.work.lifecycle).toBe("active");
    expect(view.approval).toMatchObject({ quorum: 2, declaredCount: 1, canDeclare: true });
    expect(view.approval.approvers.map((a) => a.declared)).toEqual([true, false, false]);
    expect(view.approval.approvers.map((a) => a.isMe)).toEqual([false, true, false]);
    expect(view.people.approvers).toHaveLength(3);
    // 宣言した本人はもう宣言できない（二重に数えない）
    await expect(
      cast.approver.as.mutation(api.approvals.finalize, { workId, revisionId }),
    ).rejects.toThrow(code("approval_already_declared"));

    const second = await cast.stranger.as.mutation(api.approvals.finalize, { workId, revisionId });
    expect(second).toMatchObject({ finalized: true, declared: 2 });
    const done = await cast.reviewer.as.query(api.works.get, { workId });
    expect(done.work.lifecycle).toBe("finalized");
    expect(done.approval.declaredCount).toBe(2);
  });

  it("校了者でない人は宣言できない。一覧は校了者の全員と進み具合を返し、校了者を決める権限のある人にだけ編集を許す", async () => {
    const { t, cast, workId, revisionId } = await setup();
    await expect(
      cast.manager.as.mutation(api.approvals.finalize, { workId, revisionId }),
    ).rejects.toThrow(code("forbidden"));
    await cast.reviewer.as.mutation(api.approvals.finalize, { workId, revisionId });

    // Nogiku Access 接続後の挙動: 主管（manager）だけが approvers:assign を持ち、校了者本人は持たない
    vi.stubEnv("NOGIKU_ACCESS_ENABLED", "true");
    await t.run(async (ctx) => {
      await ctx.db.patch(cast.manager.id, { orgPermissions: ["approvers:assign"] });
      await ctx.db.patch(cast.approver.id, { orgPermissions: [] });
    });
    const row = (await cast.manager.as.query(api.works.listMine, {})).find((w) => w.id === workId)!;
    expect(row.approvers.map((a) => a.id)).toEqual([
      cast.approver.id,
      cast.reviewer.id,
      cast.stranger.id,
    ]);
    expect(row).toMatchObject({
      approvalQuorum: 2,
      approvalDeclared: 1,
      canEditApprovers: true,
    });
    const asApprover = (await cast.approver.as.query(api.works.listMine, {})).find(
      (w) => w.id === workId,
    )!;
    expect(asApprover.canEditApprovers).toBe(false);
    // 権限が無い人は、一覧のセルからも変えられない
    await expect(
      cast.approver.as.mutation(api.works.update, { workId, patch: { approvalQuorum: 1 } }),
    ).rejects.toThrow(code("forbidden"));
    // 権限のある人は、主管でなくても（work.edit が無くても）校了者を変えられる
    await t.run((ctx) => ctx.db.patch(cast.stranger.id, { orgPermissions: ["approvers:assign"] }));
    const asDecider = (await cast.stranger.as.query(api.works.listMine, {})).find(
      (w) => w.id === workId,
    )!;
    expect(asDecider.canEditApprovers).toBe(true);
    await cast.stranger.as.mutation(api.works.update, { workId, patch: { approvalQuorum: 1 } });
    expect((await t.run((ctx) => ctx.db.get("works", workId)))!.approvalQuorum).toBe(1);
    vi.unstubAllEnvs();
  });

  it("人数の範囲外・校了者 0 人は保存されない", async () => {
    const { cast, workId } = await setup();
    await expect(
      cast.manager.as.mutation(api.works.update, { workId, patch: { approvalQuorum: 4 } }),
    ).rejects.toThrow(code("work_invalid"));
    await expect(
      cast.manager.as.mutation(api.works.update, { workId, patch: { approverIds: [] } }),
    ).rejects.toThrow(code("work_invalid"));
  });

  it("古い行（approverId だけ・人数なし）は 1 人・人数 1 として読み、そのまま校了できる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    // 移行前の行を直接作る（approverIds・approvalQuorum が無い）
    const workId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("works", {
        year: 100,
        title: "移行前の制作物",
        purpose: "",
        category: "印刷物",
        mediaType: "pdf",
        productionTeamIds: [],
        relatedTeamIds: [],
        managerIds: [cast.manager.id],
        creatorIds: [cast.creator.id],
        approverId: cast.approver.id,
        lifecycle: "active",
        confidentiality: "normal",
        version: 1,
      });
      for (const [userId, role] of [
        [cast.manager.id, "manager"],
        [cast.creator.id, "creator"],
        [cast.approver.id, "approver"],
      ] as const)
        await ctx.db.insert("workRoles", { workId: id, userId, role });
      return id;
    });
    const view = await cast.approver.as.query(api.works.get, { workId });
    expect(view.approval).toMatchObject({ quorum: 1, canDeclare: true });
    expect(view.approval.approvers.map((a) => a.user?.id)).toEqual([cast.approver.id]);

    const { revisionId } = await submitFiles(cast, workId, [
      { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" },
    ]);
    const done = await cast.approver.as.mutation(api.approvals.finalize, { workId, revisionId });
    expect(done).toMatchObject({ finalized: true, action: "finalized" });
    // 編集で初めて新しい項目が書かれる（先頭の 1 人はそのまま）
    const reopen = await cast.approver.as.mutation(api.approvals.reopen, {
      workId,
      reason: "確認のため",
    });
    expect(reopen.action).toBe("reopened");
    await cast.manager.as.mutation(api.works.update, { workId, patch: { title: "移行後" } });
    expect(await t.run((ctx) => ctx.db.get("works", workId))).toMatchObject({
      approverId: cast.approver.id,
      approverIds: [cast.approver.id],
      approvalQuorum: 1,
    });
  });
});
