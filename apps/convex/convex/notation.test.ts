import { api } from "./_generated/api";
import { describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

const rule = {
  ruleId: "A1-0001",
  categoryCode: "A1",
  title: "五月祭",
  description: "",
  correct: ["五月祭"],
  incorrect: [],
  patterns: ["[5５]月祭"],
  exceptions: [],
  language: "ja" as const,
  scopes: [],
  years: [100],
  priority: 0,
  strictness: "required" as const,
  enabled: true,
};

describe("Convex 統合: 表記統一", () => {
  it("権限はサーバーで判定し、版にルールの版を記録する。提案は承認まで反映しない", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9), toFake: ["Date"] });
    const t = createHarness();
    const cast = await createCast(t);

    // テストの主体は組織権限 "*"（Nogiku 未接続）。それでも一般ユーザーは編集できない
    await expect(cast.manager.as.mutation(api.notation.save, { rule })).rejects.toThrow(
      code("notation_not_manager"),
    );
    await cast.admin.as.mutation(api.notation.save, { rule, expectedRevision: 0 });
    await cast.admin.as.mutation(api.notation.setManager, {
      userId: cast.manager.id,
      categoryCode: "B",
      assigned: true,
    });
    const book = await cast.manager.as.query(api.notation.ruleBook, {});
    expect(book.roles.B).toBe("manager");
    expect(book.roles.A1).toBe("member");
    expect(book.managers[0]!.user.name).toBeTruthy();

    // 制作物で選んだカテゴリ（B は A を継承）で版にスナップショットが残る
    const workId = await setupWork(t, cast, { notationCategories: ["B"] });
    const set = await cast.reviewer.as.query(api.notation.rulesForWork, { workId });
    expect(set.rules.map((r) => r.ruleId)).toEqual(["A1-0001"]);
    await expect(cast.stranger.as.query(api.notation.rulesForWork, { workId })).rejects.toThrow(
      code("forbidden"),
    );
    const { revisionId } = await submitFiles(cast, workId, [
      { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" },
    ]);
    const rev = await t.run((ctx) => ctx.db.get(revisionId));
    expect(rev!.notationSnapshot!.rules).toEqual([{ ruleId: "A1-0001", revision: 1, depth: 1 }]);

    // 校正画面からの提案（制作物の閲覧権限が要る）→ 担当者が承認
    await expect(
      cast.stranger.as.mutation(api.notation.propose, {
        kind: "new",
        categoryCode: "B",
        title: "",
        correct: ["企画"],
        incorrect: ["出し物"],
        reason: "",
        context: { workId, quote: "出し物" },
      }),
    ).rejects.toThrow(code("forbidden"));
    const p = await cast.reviewer.as.mutation(api.notation.propose, {
      kind: "new",
      categoryCode: "B",
      title: "",
      correct: ["企画"],
      incorrect: ["出し物"],
      reason: "企画対応",
      context: { workId, revisionId, quote: "出し物" },
    });
    expect((await cast.reviewer.as.query(api.notation.ruleBook, {})).rules).toHaveLength(1);
    const open = await cast.manager.as.query(api.notation.proposals, { status: "open" });
    expect(open[0]!.canDecide).toBe(true);
    expect(open[0]!.proposer.name).toBeTruthy();
    await cast.manager.as.mutation(api.notation.decide, {
      proposalId: p.proposalId,
      decision: "approve",
    });
    const after = await cast.reviewer.as.query(api.notation.ruleBook, {});
    expect(after.rules.map((r) => r.ruleId).sort()).toEqual(["A1-0001", "B-P0001"]);
    const hist = await cast.reviewer.as.query(api.notation.ruleHistory, { ruleId: "B-P0001" });
    expect(hist[0]!.operation).toBe("proposal");

    // 無効化と取り込み
    await cast.admin.as.mutation(api.notation.setEnabled, { ruleId: "A1-0001", enabled: false });
    const imported = await cast.manager.as.mutation(api.notation.importBatch, {
      rules: [{ ...rule, ruleId: "B-9", categoryCode: "B" }, rule],
      notes: [{ categoryCode: "B", text: "メモ" }],
      overwrite: true,
    });
    expect(imported.created).toBe(1);
    expect(imported.errors.map((e) => e.ruleId)).toEqual(["A1-0001"]);
    vi.useRealTimers();
  });
});
