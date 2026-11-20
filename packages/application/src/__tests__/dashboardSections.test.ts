import { describe, expect, it } from "vite-plus/test";
import {
  buildCheckDashboard,
  buildDashboard,
  buildMakeDashboard,
  buildWorksDashboard,
} from "../usecases/dashboard.ts";
import { grantWorkPermission } from "../usecases/acl.ts";
import { createInMemoryContext, type InMemoryContext } from "../testing/inMemory.ts";
import { seedWork, submitRevision } from "../testing/scenario.ts";
import { principals } from "../testing/scenario.ts";
import { seedPortfolio, viewers, withoutSummaries } from "./portfolio.ts";

const everyone = [...viewers, principals.stranger] as const;

/** 呼ばれたポートの名前（`notifications.listForUser` など）を数える */
function spyPorts(ctx: InMemoryContext) {
  const calls = new Map<string, number>();
  for (const [repo, port] of Object.entries(ctx))
    if (port && typeof port === "object")
      for (const [name, fn] of Object.entries(port))
        if (typeof fn === "function")
          (port as Record<string, unknown>)[name] = (...args: unknown[]) => {
            const key = `${repo}.${name}`;
            calls.set(key, (calls.get(key) ?? 0) + 1);
            return (fn as (...a: unknown[]) => unknown).apply(port, args);
          };
  return {
    read: (prefix: string) =>
      [...calls.keys()].filter((k) => k.startsWith(prefix)).reduce((n, k) => n + calls.get(k)!, 0),
  };
}

describe("ダッシュボードの節ごとの問い合わせ", () => {
  for (const summaries of [true, false])
    it(`校正・制作・制作物の節は、全部入りのダッシュボードの該当の節と同じ（要約${summaries ? "あり" : "なし"}）`, async () => {
      const { ctx, works } = await seedPortfolio();
      if (!summaries) withoutSummaries(ctx);
      for (const who of everyone) {
        const full = await buildDashboard(ctx, who, await works());
        const { review, checks, finalize, assign } = full.mine;
        const rows = new Set(
          [...review, ...checks, ...finalize, ...assign, ...full.done].map((i) => i.workId),
        );
        expect(await buildCheckDashboard(ctx, who, await works())).toEqual({
          mine: { review, checks, finalize, assign },
          done: full.done,
          pinned: full.pinned.filter((i) => !rows.has(i.workId)),
        });

        const creatorOf = new Set(
          (await works()).filter((w) => w.creatorIds.includes(who.userId)).map((w) => w.id),
        );
        expect(await buildMakeDashboard(ctx, who, await works())).toEqual({
          submit: full.mine.submit,
          respond: full.mine.respond.filter((i) => creatorOf.has(i.workId)),
          works: full.overview.works.filter((r) => r.isCreator),
          mentions: full.mentions,
        });

        expect(await buildWorksDashboard(ctx, who, await works())).toEqual({
          pinned: full.pinned,
          backlog: full.backlog,
          nextDeadline: full.nextDeadline,
          summary: { dueSoon: full.summary.dueSoon, overdue: full.summary.overdue },
          overview: full.overview,
        });
      }
    });

  it("比べた節は空ではない（同じであることが空同士の一致にならない）", async () => {
    const { ctx, works } = await seedPortfolio();
    const reviewer = await buildCheckDashboard(ctx, principals.reviewer, await works());
    expect(reviewer.mine.review).toHaveLength(1);
    expect(reviewer.mine.checks).toHaveLength(1);
    const approver = await buildCheckDashboard(ctx, principals.approver, await works());
    expect(approver.done.map((i) => i.task)).toContain("finalize");
    const creator = await buildMakeDashboard(ctx, principals.creator, await works());
    expect(creator.respond.length).toBeGreaterThan(0);
    expect(creator.submit.length).toBeGreaterThan(0);
    expect(creator.works.length).toBeGreaterThan(0);
    expect(creator.mentions.length).toBeGreaterThan(0);
    const manager = await buildWorksDashboard(ctx, principals.manager, await works());
    expect(manager.overview.works.length).toBeGreaterThan(0);
    expect(manager.backlog.overdue.length).toBeGreaterThan(0);
    expect((await buildWorksDashboard(ctx, principals.creator, await works())).pinned).toHaveLength(
      3,
    );
    expect((await buildCheckDashboard(ctx, principals.creator, await works())).pinned).toHaveLength(
      3,
    );
  });

  it("校正の節は通知・担当の一覧を読まない（それらの書込みで再実行されない）", async () => {
    const { ctx, works } = await seedPortfolio();
    const list = await works();
    const ports = spyPorts(ctx);
    for (const who of everyone) await buildCheckDashboard(ctx, who, list);
    expect(ports.read("notifications.")).toBe(0);
    expect(ports.read("teams.")).toBe(0);
    expect(ports.read("threads.")).toBe(0);
  });

  it("制作の節は、制作者でない制作物の版・割当・専門確認を読まず、ピン留めも読まない", async () => {
    const { ctx, works } = await seedPortfolio();
    const list = await works();
    const ports = spyPorts(ctx);
    await buildMakeDashboard(ctx, principals.reviewer, list);
    expect(ports.read("workSummaries.")).toBe(0);
    expect(ports.read("assignments.")).toBe(0);
    expect(ports.read("checks.")).toBe(0);
    expect(ports.read("home.")).toBe(0);
  });

  it("制作物の節は、校正者の割当・専門確認を 1 件ずつ読まない（進み具合の行から数える）。進み具合が無ければ読んで同じ値になる", async () => {
    const { ctx, works } = await seedPortfolio();
    const list = await works();
    const ports = spyPorts(ctx);
    const withProgress = await buildWorksDashboard(ctx, principals.manager, list);
    expect(ports.read("assignments.listByRevision")).toBe(0);
    expect(ports.read("checks.listByRevision")).toBe(0);
    expect(withProgress.overview.reviewers.total).toBeGreaterThan(0);
    expect(withProgress.overview.checksPending).toBeGreaterThan(0);
    withoutSummaries(ctx);
    expect(await buildWorksDashboard(ctx, principals.manager, list)).toEqual(withProgress);
    expect(ports.read("assignments.listByRevision")).toBeGreaterThan(0);
  });

  it("進み具合が別の版の分（古い）なら信じず、割当・専門確認から数え直す", async () => {
    const { ctx, works } = await seedPortfolio();
    const list = await works();
    const expected = await buildWorksDashboard(ctx, principals.manager, list);
    const real = ctx.workSummaries.findProgress.bind(ctx.workSummaries);
    // 古い行を読んだ場合（数えた版が今の受付中の版と違う）は、アダプタが null を返す契約。ここでは null を返して数え直す道を通す
    ctx.workSummaries.findProgress = async (workId, acceptingId) =>
      (await real(workId, acceptingId)) && null;
    expect(await buildWorksDashboard(ctx, principals.manager, list)).toEqual(expected);
  });

  it("許可（ACL）は職責で足りるなら読まない。足りないときは本人の分だけ読み、判定は変わらない", async () => {
    const { ctx, works } = await seedPortfolio();
    const list = await works();
    const ports = spyPorts(ctx);
    for (const who of everyone) await buildWorksDashboard(ctx, who, list);
    await buildMakeDashboard(ctx, principals.creator, list);
    expect(ports.read("acl.")).toBe(0);
  });

  it("許可の無い人は「割り当てる」に出ない。edit の許可がある人だけが出る（許可を後から読んでも判定は同じ）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { title: "未割当" });
    await submitRevision(ctx, work.id, { deadlineInHours: 48 });
    const list = [(await ctx.works.findById(work.id))!];
    // 職責も許可も無い人
    expect((await buildCheckDashboard(ctx, principals.stranger, list)).mine.assign).toEqual([]);
    // 他の人への edit の許可は、この人の判定に効かない
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "edit",
    });
    expect((await buildCheckDashboard(ctx, principals.stranger, list)).mine.assign).toEqual([]);
    // review の許可では足りない
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.stranger.userId],
      permission: "review",
    });
    expect((await buildCheckDashboard(ctx, principals.stranger, list)).mine.assign).toEqual([]);
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.stranger.userId],
      permission: "edit",
    });
    expect(
      (await buildCheckDashboard(ctx, principals.stranger, list)).mine.assign.map((i) => i.workId),
    ).toEqual([work.id]);
  });

  it("制作物の節は通知を読まない", async () => {
    const { ctx, works } = await seedPortfolio();
    const list = await works();
    const ports = spyPorts(ctx);
    for (const who of everyone) await buildWorksDashboard(ctx, who, list);
    expect(ports.read("notifications.")).toBe(0);
  });
});
