import type { RuleDraft } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import {
  decideRuleProposal,
  decideRuleProposals,
  getRuleBook,
  getRuleHistory,
  importRules,
  listRuleProposals,
  proposeRule,
  resolveRulesForWork,
  rulesOfSnapshot,
  saveCategory,
  saveRule,
  setCategoryManager,
  setRuleEnabled,
} from "../usecases/notation.ts";
import { updateWork } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const { sysadmin, manager, reviewer, stranger, creator } = principals;

const draft = (over: Partial<RuleDraft> = {}): RuleDraft => ({
  ruleId: "A1-0001",
  categoryCode: "A1",
  title: "五月祭",
  description: "固有名詞",
  correct: ["五月祭"],
  incorrect: [],
  patterns: ["[5５]月祭"],
  exceptions: [],
  language: "ja",
  scopes: [],
  years: [],
  priority: 0,
  strictness: "required",
  enabled: true,
  ...over,
});

describe("表記統一ルールの管理", () => {
  it('Nogiku 未接続（"*"）の一般ユーザーはルールを編集できない。システム管理者はできる', async () => {
    const ctx = createInMemoryContext();
    await expect(saveRule(ctx, reviewer, { rule: draft() })).rejects.toEqual(
      code("notation_not_manager"),
    );
    expect(await saveRule(ctx, sysadmin, { rule: draft() })).toEqual({
      ruleId: "A1-0001",
      revision: 1,
    });
    const book = await getRuleBook(ctx, reviewer);
    expect(book.rules).toHaveLength(1);
    expect(book.roles.A1).toBe("member");
    expect(book.categories.map((c) => c.code)).toContain("E");
  });

  it("カテゴリ管理者は担当カテゴリだけ編集でき、設定はシステム管理者だけ", async () => {
    const ctx = createInMemoryContext();
    await expect(
      setCategoryManager(ctx, manager, {
        userId: manager.userId,
        categoryCode: "B",
        assigned: true,
      }),
    ).rejects.toEqual(code("notation_not_manager"));
    await setCategoryManager(ctx, sysadmin, {
      userId: manager.userId,
      categoryCode: "B",
      assigned: true,
    });
    await saveRule(ctx, manager, { rule: draft({ ruleId: "B-1", categoryCode: "B" }) });
    await expect(saveRule(ctx, manager, { rule: draft({ ruleId: "A1-1" }) })).rejects.toEqual(
      code("notation_not_manager"),
    );
    // 担当外のカテゴリへ移すこともできない
    await expect(
      saveRule(ctx, manager, { rule: draft({ ruleId: "B-1", categoryCode: "A1" }) }),
    ).rejects.toEqual(code("notation_not_manager"));
    expect((await getRuleBook(ctx, manager)).roles.B).toBe("manager");
  });

  it("編集で版が上がり履歴が残る。古い版からの上書きは競合になる", async () => {
    const ctx = createInMemoryContext();
    await saveRule(ctx, sysadmin, { rule: draft(), expectedRevision: 0 });
    ctx.clock.advance(1000);
    await saveRule(ctx, sysadmin, {
      rule: draft({ correct: ["五月祭", "MF"] }),
      expectedRevision: 1,
      reason: "別名",
    });
    await expect(saveRule(ctx, sysadmin, { rule: draft(), expectedRevision: 1 })).rejects.toEqual(
      code("version_conflict"),
    );
    await setRuleEnabled(ctx, sysadmin, { ruleId: "A1-0001", enabled: false, reason: "廃止" });
    const hist = await getRuleHistory(ctx, reviewer, "A1-0001");
    expect(hist.map((h) => [h.revision, h.operation])).toEqual([
      [3, "disable"],
      [2, "update"],
      [1, "create"],
    ]);
    expect(hist[1]!.rule.correct).toEqual(["五月祭", "MF"]);
  });

  it("壊れた・危険な正規表現や存在しないカテゴリは保存しない", async () => {
    const ctx = createInMemoryContext();
    await expect(saveRule(ctx, sysadmin, { rule: draft({ patterns: ["(a+)+"] }) })).rejects.toEqual(
      code("notation_rule_invalid"),
    );
    await expect(saveRule(ctx, sysadmin, { rule: draft({ categoryCode: "Z" }) })).rejects.toEqual(
      code("notation_rule_invalid"),
    );
    await expect(saveRule(ctx, sysadmin, { rule: draft({ scopes: ["Q"] }) })).rejects.toEqual(
      code("notation_rule_invalid"),
    );
  });

  it("カテゴリ: 追加・継承変更は管理者、説明は担当者。循環は拒否", async () => {
    const ctx = createInMemoryContext();
    await setCategoryManager(ctx, sysadmin, {
      userId: manager.userId,
      categoryCode: "C",
      assigned: true,
    });
    const book = await getRuleBook(ctx, manager);
    const c = book.categories.find((x) => x.code === "C")!;
    await saveCategory(ctx, manager, { ...c, policyNotes: "公式文書は敬体" });
    await expect(saveCategory(ctx, manager, { ...c, parents: ["A1"] })).rejects.toEqual(
      code("notation_not_manager"),
    );
    const a1 = book.categories.find((x) => x.code === "A1")!;
    await expect(saveCategory(ctx, sysadmin, { ...a1, parents: ["C"] })).rejects.toEqual(
      code("notation_category_invalid"),
    );
    await saveCategory(ctx, sysadmin, {
      code: "F",
      name: "SNS",
      description: "",
      parents: ["A2"],
      policyNotes: "",
      order: 8,
    });
    expect(
      (await getRuleBook(ctx, stranger)).categories.find((x) => x.code === "C")!.policyNotes,
    ).toBe("公式文書は敬体");
  });

  it("取り込み: 権限のないカテゴリ・不正なルールは個別に報告し、説明行は運用メモへ", async () => {
    const ctx = createInMemoryContext();
    await setCategoryManager(ctx, sysadmin, {
      userId: manager.userId,
      categoryCode: "B",
      assigned: true,
    });
    const r = await importRules(ctx, manager, {
      rules: [
        draft({ ruleId: "B-1", categoryCode: "B" }),
        draft({ ruleId: "A1-9" }),
        draft({ ruleId: "B-2", categoryCode: "B", correct: [] }),
      ],
      notes: [{ categoryCode: "B", text: "企画名は登録名に従う" }],
      overwrite: false,
    });
    expect(r.created).toBe(1);
    expect(r.errors.map((e) => e.ruleId)).toEqual(["A1-9", "B-2"]);
    const again = await importRules(ctx, manager, {
      rules: [draft({ ruleId: "B-1", categoryCode: "B" })],
      notes: [],
      overwrite: false,
    });
    expect(again.skipped).toBe(1);
    const over = await importRules(ctx, manager, {
      rules: [draft({ ruleId: "B-1", categoryCode: "B" })],
      notes: [],
      overwrite: true,
    });
    expect(over.updated).toBe(1);
    expect(
      (await getRuleBook(ctx, manager)).categories.find((c) => c.code === "B")!.policyNotes,
    ).toContain("企画名");
  });
});

describe("制作物のルールの組と版の記録", () => {
  it("制作物で選んだカテゴリと年度でルールが決まり、提出した版にルールの版が残る", async () => {
    const ctx = createInMemoryContext();
    await saveRule(ctx, sysadmin, { rule: draft() });
    await saveRule(ctx, sysadmin, {
      rule: draft({
        ruleId: "A1-old",
        years: [99],
        correct: ["x"],
        patterns: [],
        incorrect: ["y"],
      }),
    });
    const work = await seedWork(ctx, { notationCategories: ["B"] });
    const set = await resolveRulesForWork(ctx, creator, work.id);
    expect(set.rules.map((r) => r.ruleId)).toEqual(["A1-0001"]);
    await expect(resolveRulesForWork(ctx, stranger, work.id)).rejects.toEqual(code("forbidden"));

    const rev = await submitRevision(ctx, work.id);
    expect(rev.notationSnapshot?.rules).toEqual([{ ruleId: "A1-0001", revision: 1 }]);
    // あとでルールを変えても、版のルールは提出時の内容
    await saveRule(ctx, sysadmin, { rule: draft({ correct: ["MF100"] }) });
    const restored = await rulesOfSnapshot(ctx, rev.notationSnapshot!);
    expect(restored[0]!.correct).toEqual(["五月祭"]);
    expect(restored[0]!.revision).toBe(1);
  });

  it("カテゴリ未選択の制作物は検査しない。編集で選び直せる", async () => {
    const ctx = createInMemoryContext();
    await saveRule(ctx, sysadmin, { rule: draft() });
    const work = await seedWork(ctx);
    expect((await resolveRulesForWork(ctx, creator, work.id)).rules).toEqual([]);
    const rev = await submitRevision(ctx, work.id);
    expect(rev.notationSnapshot).toBeUndefined();
    await updateWork(ctx, manager, {
      workId: work.id,
      patch: { notationCategories: ["A1", "A1", " "] },
    });
    const set = await resolveRulesForWork(ctx, creator, work.id);
    expect(set.categories).toEqual(["A1"]);
    expect(set.rules).toHaveLength(1);
  });
});

describe("ルールの変更提案", () => {
  it("提案は承認まで反映されず、同じ提案は賛同としてまとめる。担当者に通知", async () => {
    const ctx = createInMemoryContext();
    await setCategoryManager(ctx, sysadmin, {
      userId: manager.userId,
      categoryCode: "A2",
      assigned: true,
    });
    const a = await proposeRule(ctx, reviewer, {
      kind: "new",
      categoryCode: "A2",
      title: "いただく",
      correct: ["いただく"],
      incorrect: ["頂く"],
      reason: "補助動詞",
    });
    const b = await proposeRule(ctx, stranger, {
      kind: "new",
      categoryCode: "A2",
      title: "",
      correct: ["いただく"],
      incorrect: ["頂く "],
      reason: "",
    });
    expect(b.merged).toBe(true);
    expect(b.proposal.supporters).toEqual([stranger.userId]);
    expect((await getRuleBook(ctx, reviewer)).rules).toHaveLength(0);
    expect(
      ctx.state.notifications
        .all()
        .filter((n) => n.kind === "rule_proposed")
        .map((n) => n.recipientId),
    ).toEqual([manager.userId]);

    await expect(
      decideRuleProposal(ctx, reviewer, { proposalId: a.proposal.id, decision: "approve" }),
    ).rejects.toEqual(code("notation_not_manager"));
    const done = await decideRuleProposal(ctx, manager, {
      proposalId: a.proposal.id,
      decision: "approve",
      note: "OK",
    });
    expect(done.status).toBe("approved");
    const book = await getRuleBook(ctx, reviewer);
    expect(book.rules.map((r) => [r.ruleId, r.incorrect])).toEqual([["A2-P0001", ["頂く"]]]);
    expect((await getRuleHistory(ctx, reviewer, "A2-P0001"))[0]!.proposalId).toBe(a.proposal.id);
    // 提案者と賛同者に通知
    expect(
      ctx.state.notifications
        .all()
        .filter((n) => n.kind === "rule_proposal_decided")
        .map((n) => n.recipientId)
        .sort(),
    ).toEqual([reviewer.userId, stranger.userId].sort());
    await expect(
      decideRuleProposal(ctx, manager, { proposalId: a.proposal.id, decision: "reject" }),
    ).rejects.toEqual(code("notation_proposal_closed"));
  });

  it("編集して承認・既存ルールの変更提案・まとめて却下", async () => {
    const ctx = createInMemoryContext();
    await saveRule(ctx, sysadmin, { rule: draft() });
    const change = await proposeRule(ctx, reviewer, {
      kind: "change",
      categoryCode: "A1",
      ruleId: "A1-0001",
      title: "全角も",
      correct: ["五月祭"],
      incorrect: ["5月祭", "５月祭"],
      reason: "",
    });
    await decideRuleProposal(ctx, sysadmin, {
      proposalId: change.proposal.id,
      decision: "approve",
      edited: draft({ incorrect: ["5月祭", "５月祭"], patterns: [] }),
    });
    const r = (await getRuleBook(ctx, reviewer)).rules[0]!;
    expect(r.revision).toBe(2);
    expect(r.patterns).toEqual([]);

    const p1 = await proposeRule(ctx, reviewer, {
      kind: "report",
      categoryCode: "A1",
      title: "",
      correct: [],
      incorrect: ["ごがつさい"],
      reason: "",
    });
    const p2 = await proposeRule(ctx, reviewer, {
      kind: "report",
      categoryCode: "A1",
      title: "",
      correct: [],
      incorrect: ["ゴガツサイ"],
      reason: "",
    });
    const res = await decideRuleProposals(ctx, sysadmin, {
      proposalIds: [p1.proposal.id, p2.proposal.id, "nope"],
      decision: "reject",
    });
    expect(res.done).toHaveLength(2);
    expect(res.failed).toEqual([{ id: "nope", code: "forbidden" }]);
  });

  it("校正画面からの提案は制作物の閲覧権限を確かめ、見られない人には文脈を隠す", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(
      proposeRule(ctx, stranger, {
        kind: "report",
        categoryCode: "A1",
        title: "",
        correct: [],
        incorrect: ["X"],
        reason: "",
        context: { workId: work.id, quote: "機密の文" },
      }),
    ).rejects.toEqual(code("forbidden"));
    await proposeRule(ctx, creator, {
      kind: "report",
      categoryCode: "A1",
      title: "",
      correct: [],
      incorrect: ["X"],
      reason: "",
      context: { workId: work.id, quote: "機密の文" },
    });
    await setCategoryManager(ctx, sysadmin, {
      userId: stranger.userId,
      categoryCode: "A1",
      assigned: true,
    });
    const seenByManager = await listRuleProposals(ctx, stranger, { status: "open" });
    expect(seenByManager[0]!.contextHidden).toBe(true);
    expect(seenByManager[0]!.context).toEqual({});
    expect(seenByManager[0]!.canDecide).toBe(true);
    const seenByCreator = await listRuleProposals(ctx, creator, { status: null });
    expect(seenByCreator[0]!.context.quote).toBe("機密の文");
    expect(seenByCreator[0]!.canDecide).toBe(false);
    // 関係のない一般ユーザーには見えない
    expect(await listRuleProposals(ctx, reviewer, { status: null })).toEqual([]);
  });
});
