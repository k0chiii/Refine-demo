import type { RuleDraft } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { buildDashboard } from "../usecases/dashboard.ts";
import { listSubmitTargets } from "../usecases/home.ts";
import { currentRuleSet, resolveRulesForWork, saveRule } from "../usecases/notation.ts";
import { changeWorkLifecycle } from "../usecases/works.ts";
import { createInMemoryContext, type InMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

/**
 * 読み取りの量（Convex ではデータベースの帯域と、購読が再実行される範囲になる）が増えないことの確かめ。
 * 結果は変えず、読む先だけを絞っている。結果の同値は他のテストが見ているので、ここでは「読んでいないこと」を見る。
 */

/** ポートの呼び出し回数を数える（結果は変えない） */
function counted(ctx: InMemoryContext) {
  const calls = { acl: 0, revisions: 0, summaries: 0, rulesAll: 0, rulesIn: [] as string[][] };
  const acl = ctx.acl.listByWork.bind(ctx.acl);
  ctx.acl.listByWork = (id) => {
    calls.acl++;
    return acl(id);
  };
  const revisions = ctx.revisions.listByWork.bind(ctx.revisions);
  ctx.revisions.listByWork = (id) => {
    calls.revisions++;
    return revisions(id);
  };
  const summaries = ctx.workSummaries.findByWork.bind(ctx.workSummaries);
  ctx.workSummaries.findByWork = (id) => {
    calls.summaries++;
    return summaries(id);
  };
  const all = ctx.notation.listRules.bind(ctx.notation);
  ctx.notation.listRules = () => {
    calls.rulesAll++;
    return all();
  };
  const some = ctx.notation.listRulesInCategories.bind(ctx.notation);
  ctx.notation.listRulesInCategories = (codes) => {
    calls.rulesIn.push([...codes].sort());
    return some(codes);
  };
  return calls;
}

describe("提出先の候補（常時購読）は、候補にならない制作物の ACL・版を読まない", () => {
  it("制作者でない制作物・進行中でない制作物は ACL も版も読まない。結果は同じ", async () => {
    const ctx = createInMemoryContext();
    const mine = await seedWork(ctx, { title: "自分の制作物" });
    const others = [];
    for (let i = 0; i < 5; i++)
      others.push(
        await seedWork(ctx, { title: `他人の${i}`, creatorIds: [principals.manager.userId] }),
      );
    const held = await seedWork(ctx, { title: "保留" });
    await changeWorkLifecycle(ctx, principals.manager, { workId: held.id, to: "on_hold" });
    await submitRevision(ctx, mine.id);
    const works = await Promise.all(
      [mine, ...others, held].map(async (w) => (await ctx.works.findById(w.id))!),
    );
    const calls = counted(ctx);
    const targets = await listSubmitTargets(ctx, principals.creator, works);
    expect(targets.map((t) => t.workTitle)).toEqual(["自分の制作物"]);
    // 読んだのは候補の 1 件ぶんだけ（他の 6 件は制作物そのものの値で除外）
    expect(calls.acl).toBe(1);
    expect(calls.summaries).toBe(1);
    expect(calls.revisions).toBe(0);
  });
});

describe("ダッシュボード: 進行中でない通常の制作物は ACL を読まずに表の行に数える", () => {
  it("保留の通常制作物は ACL を読まない。非公開は従来どおり ACL で見られるかを確かめる", async () => {
    const ctx = createInMemoryContext();
    const held = await seedWork(ctx, { title: "保留" });
    await changeWorkLifecycle(ctx, principals.manager, { workId: held.id, to: "on_hold" });
    const secret = await seedWork(ctx, { title: "非公開", confidentiality: "restricted" });
    await changeWorkLifecycle(ctx, principals.manager, { workId: secret.id, to: "on_hold" });
    const works = await Promise.all(
      [held, secret].map(async (w) => (await ctx.works.findById(w.id))!),
    );
    const calls = counted(ctx);
    const d = await buildDashboard(ctx, principals.reviewer, works);
    // 校正者: 通常の保留は見られる（行に出る）。非公開の保留は見られない（出ない）
    expect(d.overview.works.map((r) => r.title)).toEqual(["保留"]);
    expect(calls.acl).toBe(1); // 非公開の判定のぶんだけ
    const own = await buildDashboard(ctx, principals.manager, works);
    expect(own.overview.works.map((r) => r.title).sort()).toEqual(["保留", "非公開"]);
  });
});

describe("制作物のルールの組: 当てはまるカテゴリのルールだけを読む", () => {
  const rule = (over: Partial<RuleDraft>): RuleDraft => ({
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

  it("選んだカテゴリとその継承元だけを索引で読み、ルール全件は読まない。何も選ばなければ読まない", async () => {
    const ctx = createInMemoryContext();
    await saveRule(ctx, principals.sysadmin, {
      rule: rule({ ruleId: "A1-1", categoryCode: "A1" }),
    });
    await saveRule(ctx, principals.sysadmin, { rule: rule({ ruleId: "B-1", categoryCode: "B" }) });
    await saveRule(ctx, principals.sysadmin, { rule: rule({ ruleId: "Z-1", categoryCode: "A2" }) });
    const work = await seedWork(ctx, { notationCategories: ["B"] });
    const calls = counted(ctx);

    const set = await resolveRulesForWork(ctx, principals.creator, work.id);
    expect(set.rules.map((r) => r.ruleId).sort()).toEqual(["A1-1", "B-1", "Z-1"].sort());
    expect(calls.rulesAll).toBe(0);
    expect(calls.rulesIn).toHaveLength(1);
    // B と、B が継承するカテゴリ（B は A1〜A3 を継承）。無関係なカテゴリは含まない
    expect(calls.rulesIn[0]).toContain("B");
    expect(calls.rulesIn[0]).toContain("A1");

    // 継承の無いカテゴリだけを選ぶと、そのカテゴリのルールだけ（A1 を選んでも B のルールは来ない）
    const only = await currentRuleSet(ctx, ["A1"], 100);
    expect(only.rules.map((r) => r.ruleId)).toEqual(["A1-1"]);
    expect(calls.rulesIn[1]).not.toContain("B");

    // 何も選ばなければルールは 1 件も読まない
    const before = calls.rulesIn.length;
    expect((await currentRuleSet(ctx, [], 100)).rules).toEqual([]);
    expect(calls.rulesIn).toHaveLength(before);
    expect(calls.rulesAll).toBe(0);
  });
});
