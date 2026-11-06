import type { RuleDraft } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import {
  buildCheckDashboard,
  buildDashboard,
  buildMakeDashboard,
  buildWorksDashboard,
} from "../usecases/dashboard.ts";
import { listSubmitTargets, setWorkPinned } from "../usecases/home.ts";
import { listMyNotifications, notify } from "../usecases/notifications.ts";
import { currentRuleSet, resolveRulesForWork, saveRule } from "../usecases/notation.ts";
import { createInMemoryContext, type InMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision, putOnHoldDirectly } from "../testing/scenario.ts";

/**
 * 読み取りの量（Convex ではデータベースの帯域と、購読が再実行される範囲になる）が増えないことの確かめ。
 * 結果は変えず、読む先だけを絞っている。結果の同値は他のテストが見ているので、ここでは「読んでいないこと」を見る。
 */

/** ポートの呼び出し回数を数える（結果は変えない） */
function counted(ctx: InMemoryContext) {
  const calls = {
    acl: 0,
    aclMine: 0,
    revisions: 0,
    summaries: 0,
    rulesAll: 0,
    rulesIn: [] as string[][],
  };
  const acl = ctx.acl.listByWork.bind(ctx.acl);
  ctx.acl.listByWork = (id) => {
    calls.acl++;
    return acl(id);
  };
  const mine = ctx.acl.listForPrincipal.bind(ctx.acl);
  ctx.acl.listForPrincipal = (p) => {
    calls.aclMine++;
    return mine(p);
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
    await putOnHoldDirectly(ctx, held.id);
    await submitRevision(ctx, mine.id);
    const works = await Promise.all(
      [mine, ...others, held].map(async (w) => (await ctx.works.findById(w.id))!),
    );
    const calls = counted(ctx);
    const targets = await listSubmitTargets(ctx, principals.creator, works);
    expect(targets.map((t) => t.workTitle)).toEqual(["自分の制作物"]);
    // 制作者は職責で提出できるので ACL は読まない。読んだのは候補の 1 件ぶんの要約だけ（他の 6 件は制作物そのものの値で除外）
    expect(calls.acl).toBe(0);
    expect(calls.aclMine).toBe(0);
    expect(calls.summaries).toBe(1);
    expect(calls.revisions).toBe(0);
  });
});

describe("ダッシュボード: 進行中でない通常の制作物は ACL を読まずに表の行に数える", () => {
  it("保留の制作物は ACL を読まずに表に出る（105A）", async () => {
    const ctx = createInMemoryContext();
    const held = await seedWork(ctx, { title: "保留" });
    await putOnHoldDirectly(ctx, held.id);
    const secret = await seedWork(ctx, { title: "非公開" });
    await putOnHoldDirectly(ctx, secret.id);
    const works = await Promise.all(
      [held, secret].map(async (w) => (await ctx.works.findById(w.id))!),
    );
    const calls = counted(ctx);
    const d = await buildDashboard(ctx, principals.reviewer, works);
    expect(d.overview.works.map((r) => r.title).sort()).toEqual(["保留", "非公開"].sort());
    expect(calls.acl).toBe(0);
    const own = await buildDashboard(ctx, principals.manager, works);
    expect(own.overview.works.map((r) => r.title).sort()).toEqual(["保留", "非公開"]);
  });
});

describe("ダッシュボード・通知は、制作物ごとに ACL を読まない（自分に付いた許可を 1 回だけ読む）", () => {
  async function setup() {
    const ctx = createInMemoryContext();
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const w = await seedWork(ctx, { title: `制作物${i}` });
      await submitRevision(ctx, w.id);
      ids.push(w.id);
    }
    await setWorkPinned(ctx, principals.reviewer, { workId: ids[0]!, pinned: true });
    const works = await Promise.all(ids.map(async (id) => (await ctx.works.findById(id))!));
    return { ctx, works, ids };
  }

  it("校正・制作・制作物の節は、進行中の制作物が何件あっても ACL を 1 回まで", async () => {
    const { ctx, works } = await setup();
    for (const who of [principals.reviewer, principals.creator, principals.manager]) {
      for (const build of [buildCheckDashboard, buildMakeDashboard, buildWorksDashboard]) {
        const calls = counted(ctx);
        await build(ctx, who, works);
        expect(calls.acl, build.name).toBe(0);
        expect(calls.aclMine, build.name).toBeLessThanOrEqual(1);
      }
    }
  });

  it("通知の一覧は、制作物ごとに ACL を読まない", async () => {
    const { ctx, ids } = await setup();
    for (const id of ids)
      await notify(ctx, [principals.reviewer.userId], principals.manager.userId, {
        kind: "comment_posted",
        title: "コメント",
        body: "本文",
        workId: id,
      });
    const calls = counted(ctx);
    const list = await listMyNotifications(ctx, principals.reviewer, 50);
    expect(list.filter((n) => n.kind === "comment_posted")).toHaveLength(4);
    expect(calls.acl).toBe(0);
    expect(calls.aclMine).toBeLessThanOrEqual(1);
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
