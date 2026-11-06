import { latestReplies, type RuleDraft } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { acceptingRevisionIdOf } from "../shared.ts";
import { grantWorkPermission } from "../usecases/acl.ts";
import {
  deleteReply,
  editReply,
  postComment,
  presentThreadActivity,
  replyToThread,
  THREAD_RECENT_EVENTS_READ,
} from "../usecases/comments.ts";
import {
  buildCheckDashboard,
  buildDashboard,
  buildMakeDashboard,
  buildWorksDashboard,
} from "../usecases/dashboard.ts";
import { listSubmitTargets, setWorkPinned } from "../usecases/home.ts";
import { listMyNotifications, notify } from "../usecases/notifications.ts";
import { currentRuleSet, resolveRulesForWork, saveRule } from "../usecases/notation.ts";
import { voidRevisionUseCase } from "../usecases/submissions.ts";
import { createInMemoryContext, type InMemoryContext } from "../testing/inMemory.ts";
import {
  HOUR,
  principals,
  putOnHoldDirectly,
  seedWork,
  submitRevision,
} from "../testing/scenario.ts";

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

describe("版の画面のスレッド一覧: 直近の返信は最後の数件のイベントだけから出す", () => {
  /** イベントの読み方を数える（全件・最後の数件） */
  function countEvents(ctx: InMemoryContext) {
    const calls = { all: 0, latest: [] as number[] };
    const all = ctx.threads.listEvents.bind(ctx.threads);
    ctx.threads.listEvents = (id) => {
      calls.all++;
      return all(id);
    };
    const latest = ctx.threads.listLatestEvents.bind(ctx.threads);
    ctx.threads.listLatestEvents = (id, limit) => {
      calls.latest.push(limit);
      return latest(id, limit);
    };
    return calls;
  }

  async function setup() {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const revision = await submitRevision(ctx, work.id, { deadlineInHours: 24 });
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    const thread = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "団体名が誤り",
      kind: "correction",
      severity: "major",
    });
    const reply = async (body: string, who = principals.creator) => {
      ctx.clock.current += 1000;
      await replyToThread(ctx, who, { threadId: thread.id, body });
    };
    const replyIds = async () =>
      (await ctx.threads.listEvents(thread.id))
        .filter((e) => e.eventType === "replied")
        .map((e) => e.id!);
    const present = async () => {
      const threads = await ctx.threads.listByRevision(revision.id);
      return (await presentThreadActivity(ctx, principals.reviewer, threads)).get(thread.id)!;
    };
    /** 全件のイベントから導いた直近の返信（今までの読み方と同じ結果） */
    const expected = async () =>
      latestReplies(await ctx.threads.listEvents(thread.id)).map((r) => r.body);
    return { ctx, revision, thread, reply, replyIds, present, expected };
  }

  it("返信の多いスレッドでも、全件は読まずに最後の数件だけを読む。結果は全件から導いたものと同じ", async () => {
    const { ctx, thread, reply, replyIds, present, expected } = await setup();
    for (let i = 1; i <= THREAD_RECENT_EVENTS_READ * 2; i++) await reply(`返信${i}`);
    // 最後の返信を消すと、さかのぼって残りの返信が入る（消した印も最後の数件に入る）
    ctx.clock.current += 1000;
    await deleteReply(ctx, principals.creator, {
      threadId: thread.id,
      replyEventId: (await replyIds()).at(-1)!,
    });
    const want = await expected();
    expect(want).toEqual([
      `返信${THREAD_RECENT_EVENTS_READ * 2 - 3}`,
      `返信${THREAD_RECENT_EVENTS_READ * 2 - 2}`,
      `返信${THREAD_RECENT_EVENTS_READ * 2 - 1}`,
    ]);
    const calls = countEvents(ctx);
    const v = await present();
    expect(v.latestReplies.map((r) => r.body)).toEqual(want);
    expect(v.replyCount).toBe(THREAD_RECENT_EVENTS_READ * 2 - 1);
    expect(calls.all).toBe(0);
    expect(calls.latest).toEqual([THREAD_RECENT_EVENTS_READ]);
  });

  it("最後の数件に出すべき返信が揃わない（返信の後に削除・訂正が続いた）ときは、全件を読む。結果は同じ", async () => {
    const { ctx, thread, reply, replyIds, present, expected } = await setup();
    for (let i = 1; i <= 4; i++) await reply(`返信${i}`);
    for (let i = 5; i <= THREAD_RECENT_EVENTS_READ; i++) await reply(`消す${i}`);
    // 後ろの返信を消し、残った返信を何度も訂正する（最後の数件は削除・訂正の印で埋まる）
    for (const id of (await replyIds()).slice(4)) {
      ctx.clock.current += 1000;
      await deleteReply(ctx, principals.creator, { threadId: thread.id, replyEventId: id });
    }
    const first = (await replyIds())[0]!;
    for (let i = 0; i < THREAD_RECENT_EVENTS_READ; i++) {
      ctx.clock.current += 1000;
      await editReply(ctx, principals.creator, {
        threadId: thread.id,
        replyEventId: first,
        body: `訂正${i}`,
      });
    }
    const want = await expected();
    expect(want).toEqual(["返信2", "返信3", "返信4"]);
    const calls = countEvents(ctx);
    const v = await present();
    expect(v.latestReplies.map((r) => r.body)).toEqual(want);
    expect(calls.latest).toEqual([THREAD_RECENT_EVENTS_READ]);
    expect(calls.all).toBe(1);
  });

  it("やり取りを持たない古いスレッドは、今まで通り全件から導く", async () => {
    const { ctx, revision } = await setup();
    const legacy = await ctx.threads.insert({
      revisionId: revision.id,
      authorId: principals.reviewer.userId,
      body: "古いコメント",
      kind: "correction",
      severity: "major",
      resolution: "open",
      createdAt: ctx.clock.now(),
    });
    await ctx.threads.appendEvent({
      threadId: legacy.id,
      eventType: "replied",
      actorId: principals.creator.userId,
      payload: { body: "返信" },
      createdAt: legacy.createdAt + 10,
    });
    const calls = countEvents(ctx);
    const v = (await presentThreadActivity(ctx, principals.reviewer, [legacy])).get(legacy.id)!;
    expect(v.replyCount).toBe(1);
    expect(v.latestReplies.map((r) => r.body)).toEqual(["返信"]);
    expect(calls.all).toBe(1);
    expect(calls.latest).toEqual([]);
  });
});

describe("版の画面: 受付中の版は、制作物の全ての版を読まずに決める", () => {
  it("開いた版が受付中ならそれ。そうでなければ要約から。要約が無ければ版から数える。結果は全ての版から探したものと同じ", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const first = await submitRevision(ctx, work.id);
    ctx.clock.current += HOUR;
    const second = await submitRevision(ctx, work.id);
    const old = (await ctx.revisions.findById(first.id))!;
    const now = (await ctx.revisions.findById(second.id))!;
    expect(old.reviewState).not.toBe("open");
    expect(now.reviewState).toBe("open");

    const calls = counted(ctx);
    expect(await acceptingRevisionIdOf(ctx, now)).toBe(second.id);
    expect(calls).toMatchObject({ revisions: 0, summaries: 0 });
    expect(await acceptingRevisionIdOf(ctx, old)).toBe(second.id);
    expect(calls).toMatchObject({ revisions: 0, summaries: 1 });

    // 要約の無い（古い）制作物は版から数える
    ctx.workSummaries.findByWork = async () => null;
    expect(await acceptingRevisionIdOf(ctx, old)).toBe(second.id);
    expect(calls.revisions).toBe(1);

    // 受付中の版が無ければ null
    await voidRevisionUseCase(ctx, principals.creator, { revisionId: second.id, reason: "誤提出" });
    const voided = (await ctx.revisions.findById(second.id))!;
    expect(await acceptingRevisionIdOf(ctx, voided)).toBeNull();
    expect(await acceptingRevisionIdOf(ctx, old)).toBeNull();
  });

  it("要約がこの版を受付中と言うのに版が受付中でない（要約が古い）ときは、要約を信じず版から数える", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const revision = await submitRevision(ctx, work.id);
    const summary = (await ctx.workSummaries.findByWork(work.id))!;
    await voidRevisionUseCase(ctx, principals.creator, {
      revisionId: revision.id,
      reason: "誤提出",
    });
    ctx.workSummaries.findByWork = async () => summary; // 書き換えられる前の要約
    const calls = counted(ctx);
    const voided = (await ctx.revisions.findById(revision.id))!;
    expect(await acceptingRevisionIdOf(ctx, voided)).toBeNull();
    expect(calls.revisions).toBe(1);
  });
});
