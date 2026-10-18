import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import { submitFiles } from "../test/flows";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

describe("Convex 統合: 独立確認と制作物の不変条件（PR #1 レビュー P1 / P2）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("自己校了は申告の確認者 ID では通らず、確認者本人が記録した独立確認で通る", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    // 決定前に保存された行（制作者＝校了権限者）。登録ではこの形を作れないので、保存済みの行を直接書き換えて再現する
    const workId = (await cast.manager.as.mutation(api.works.create, {
      title: "自己校了のポスター",
      purpose: "",
      category: "印刷物",
      mediaType: "pdf",
      year: 100,
      creatorIds: [cast.creator.id],
      approverId: cast.approver.id,
    })) as Id<"works">;
    await t.run((ctx) =>
      ctx.db.patch(workId, {
        approverId: cast.creator.id,
        approverIds: undefined,
        approvalQuorum: undefined,
      }),
    );
    await cast.admin.as.mutation(api.acl.grant, {
      workId,
      principalType: "user",
      principalId: cast.reviewer.id,
      permission: "review",
    });
    const { revisionId } = await submitFiles(cast, workId, [
      { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" },
    ]);

    // 公開の入口から確認者 ID を申告することはもうできない
    await expect(
      cast.creator.as.mutation(api.approvals.finalize, {
        workId,
        revisionId,
        independentConfirmerId: "nonexistent-user",
      } as never),
    ).rejects.toThrow();
    await expect(
      cast.creator.as.mutation(api.approvals.finalize, { workId, revisionId }),
    ).rejects.toThrow(code("approval_self_approval_not_allowed"));

    // 制作者本人・関与していない人は確認を記録できない
    await expect(cast.creator.as.mutation(api.approvals.confirm, { revisionId })).rejects.toThrow(
      code("approval_confirmer_not_independent"),
    );
    await expect(cast.stranger.as.mutation(api.approvals.confirm, { revisionId })).rejects.toThrow(
      code("forbidden"),
    );

    expect(
      await cast.reviewer.as.query(api.approvals.confirmationStatus, { workId }),
    ).toMatchObject({ required: true, valid: null, canConfirm: true, confirmedByMe: false });
    await cast.reviewer.as.mutation(api.approvals.confirm, { revisionId, note: "全体を確認" });
    const status = await cast.creator.as.query(api.approvals.confirmationStatus, { workId });
    expect(status).toMatchObject({
      required: true,
      candidateRevisionId: revisionId,
      canConfirm: false,
      valid: { confirmer: { id: cast.reviewer.id, name: "reviewer" }, note: "全体を確認" },
    });

    await expect(
      cast.creator.as.mutation(api.approvals.finalize, { workId, revisionId }),
    ).resolves.toMatchObject({ action: "finalized" });
    const rows = await t.run((ctx) => ctx.db.query("approvalConfirmations").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workId, revisionId, confirmerId: cast.reviewer.id });
  });

  it("制作物の登録・変更は空の名称・制作者・校了権限者と、名簿にいない人を受け付けない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const base = {
      title: "ポスター",
      purpose: "",
      category: "印刷物",
      mediaType: "pdf" as const,
      year: 100,
      creatorIds: [cast.creator.id as string],
      approverId: cast.approver.id as string,
    };
    await expect(
      cast.manager.as.mutation(api.works.create, { ...base, creatorIds: [""] }),
    ).rejects.toThrow(code("work_invalid"));
    await expect(
      cast.manager.as.mutation(api.works.create, { ...base, approverId: "" }),
    ).rejects.toThrow(code("work_invalid"));
    await expect(
      cast.manager.as.mutation(api.works.create, { ...base, approverId: "nonexistent-user" }),
    ).rejects.toThrow(code("work_invalid"));

    const workId = (await cast.manager.as.mutation(api.works.create, base)) as Id<"works">;
    await expect(
      cast.manager.as.mutation(api.works.update, {
        workId,
        patch: { title: "   ", creatorIds: [], approverId: "" },
      }),
    ).rejects.toThrow(code("work_invalid"));
    const work = await t.run((ctx) => ctx.db.get("works", workId));
    expect(work).toMatchObject({ title: "ポスター", approverId: cast.approver.id, version: 1 });
  });

  it("制作者は校了者になれない（登録・校了者の変更・制作者の変更のどれも拒否。利用者決定 2026-10-18）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const base = {
      title: "ポスター",
      purpose: "",
      category: "印刷物",
      mediaType: "pdf" as const,
      year: 100,
      creatorIds: [cast.creator.id as string],
      approverId: cast.approver.id as string,
    };
    const overlap = expect.objectContaining({
      data: expect.objectContaining({
        code: "work_invalid",
        details: expect.objectContaining({ field: "approverIds", reason: "creator_is_approver" }),
      }),
    });
    await expect(
      cast.manager.as.mutation(api.works.create, { ...base, approverId: cast.creator.id }),
    ).rejects.toThrow(overlap);
    await expect(
      cast.manager.as.mutation(api.works.create, {
        ...base,
        approverIds: [cast.approver.id, cast.creator.id],
      }),
    ).rejects.toThrow(overlap);

    const workId = (await cast.manager.as.mutation(api.works.create, base)) as Id<"works">;
    // 一覧の表のセルからの変更も同じ works.update を通る
    await expect(
      cast.manager.as.mutation(api.works.update, {
        workId,
        patch: { approverIds: [cast.creator.id] },
      }),
    ).rejects.toThrow(overlap);
    await expect(
      cast.manager.as.mutation(api.works.update, {
        workId,
        patch: { creatorIds: [cast.creator.id, cast.approver.id] },
      }),
    ).rejects.toThrow(overlap);
    const after = await t.run((ctx) => ctx.db.get("works", workId));
    expect(after).toMatchObject({ approverId: cast.approver.id, version: 1 });
  });
});
