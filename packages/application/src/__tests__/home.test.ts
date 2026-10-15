import { endOfJstDay, type DashboardWidgetPref } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { addRequiredCheck } from "../usecases/checks.ts";
import { postComment } from "../usecases/comments.ts";
import { buildDashboard, dashboardPolicy } from "../usecases/dashboard.ts";
import {
  defaultDashboardLayout,
  homeListPolicy,
  listSubmitTargets,
  recordWorkOpened,
  resetDashboardLayout,
  saveDashboardLayout,
  setWorkPinned,
} from "../usecases/home.ts";
import { changeWorkLifecycle, importWorks } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const DAY = 86_400_000;

async function setup() {
  const ctx = createInMemoryContext();
  const now = ctx.clock.now();
  const late = await seedWork(ctx, { title: "B 遅い納期", deadlineAt: now + 20 * DAY });
  const soon = await seedWork(ctx, { title: "A 近い納期", deadlineAt: now + 3 * DAY });
  const text = await seedWork(ctx, { title: "C 文章", mediaType: "document" });
  const held = await seedWork(ctx, { title: "D 保留" });
  await changeWorkLifecycle(ctx, principals.manager, { workId: held.id, to: "on_hold" });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: soon.id,
    principalType: "user",
    principalId: principals.reviewer.userId,
    permission: "review",
  });
  const all = async () =>
    Promise.all([late, soon, text, held].map(async (w) => (await ctx.works.findById(w.id))!));
  return { ctx, late, soon, text, held, all };
}

describe("版を提出する制作物（L-15）", () => {
  it("制作者には進行中の制作物を納期順に。文章はエディタへ。保留中・他人には出さない", async () => {
    const { ctx, all } = await setup();
    const targets = await listSubmitTargets(ctx, principals.creator, await all());
    expect(targets.map((t) => t.workTitle)).toEqual(["A 近い納期", "B 遅い納期", "C 文章"]);
    expect(targets.map((t) => t.route)).toEqual(["upload", "upload", "write"]);
    expect(await listSubmitTargets(ctx, principals.reviewer, await all())).toEqual([]);
    expect(await listSubmitTargets(ctx, principals.manager, await all())).toEqual([]);
  });

  it("受付中の版があっても出し、受付中の版を添える", async () => {
    const { ctx, soon, all } = await setup();
    await submitRevision(ctx, soon.id);
    const [first] = await listSubmitTargets(ctx, principals.creator, await all());
    expect(first).toMatchObject({ workTitle: "A 近い納期", acceptingLabel: "第1版" });
    const d = await buildDashboard(ctx, principals.creator, await all());
    expect(d.mine.submit.map((i) => i.workTitle)).toEqual(["A 近い納期", "B 遅い納期", "C 文章"]);
    expect(d.mine.submit[0]!.note).toBe("第1版が受付中");
  });
});

describe("自分だけのダッシュボード（W-26 段階 1）", () => {
  it("専門確認の担当・次の締切（7 日以内）・役割の件数", async () => {
    const { ctx, soon, all } = await setup();
    const rev = await submitRevision(ctx, soon.id, { deadlineInHours: 48 });
    await addRequiredCheck(ctx, principals.manager, {
      revisionId: rev.id,
      type: "photo",
      assigneeId: principals.reviewer.userId,
    });
    const reviewer = await buildDashboard(ctx, principals.reviewer, await all());
    expect(reviewer.mine.checks.map((i) => i.note)).toEqual(["写真（肖像・権利）"]);
    expect(reviewer.roles).toMatchObject({ reviewer: 1, checker: 1, creator: 0 });
    // 既定の構成は持っている役割（校正・専門確認）の節が先
    expect(reviewer.layout.slice(0, 2).map((w) => w.id)).toEqual(["review", "checks"]);

    const creator = await buildDashboard(ctx, principals.creator, await all());
    expect(creator.roles.creator).toBe(3);
    expect(creator.layout[0]!.id).toBe("submit");
    // 校正の締切（2 日後）と納期（3 日後）。20 日後の納期は 7 日の外
    expect(creator.upcoming.map((i) => [i.workTitle, i.deadlineKind])).toEqual([
      ["A 近い納期", "review"],
      ["A 近い納期", "delivery"],
    ]);
    expect(creator.nextDeadline?.deadlineKind).toBe("review");
  });

  it("自分宛てのコメント（メンション・新しいコメント）。見られない制作物の通知は出さない", async () => {
    const { ctx, soon, all } = await setup();
    const rev = await submitRevision(ctx, soon.id);
    await postComment(ctx, principals.reviewer, {
      revisionId: rev.id,
      body: "@校了 ここを確認してください",
      kind: "correction",
      severity: "major",
      mentions: [principals.approver.userId],
    });
    const approver = await buildDashboard(ctx, principals.approver, await all());
    expect(approver.mentions).toHaveLength(1);
    expect(approver.mentions[0]).toMatchObject({ workTitle: "A 近い納期", unread: true });
    const creator = await buildDashboard(ctx, principals.creator, await all());
    expect(creator.mentions).toHaveLength(1);
    expect(creator.mentions[0]!.threadId).toBeTruthy();
    // 期間を過ぎた通知は出さない
    ctx.clock.advance(dashboardPolicy.mentionsWithinMs + 1);
    expect((await buildDashboard(ctx, principals.creator, await all())).mentions).toHaveLength(0);
  });

  it("ピン留めと最近開いた制作物。見られない制作物はピン留めできない", async () => {
    const { ctx, soon, late, all } = await setup();
    await setWorkPinned(ctx, principals.reviewer, { workId: soon.id, pinned: true });
    await expect(
      setWorkPinned(ctx, principals.reviewer, { workId: late.id, pinned: true }),
    ).rejects.toThrow("forbidden");
    await recordWorkOpened(ctx, principals.reviewer, soon.id);
    let d = await buildDashboard(ctx, principals.reviewer, await all());
    expect(d.pinned.map((i) => i.workTitle)).toEqual(["A 近い納期"]);
    expect(d.recent.map((i) => i.workTitle)).toEqual(["A 近い納期"]);
    await setWorkPinned(ctx, principals.reviewer, { workId: soon.id, pinned: false });
    d = await buildDashboard(ctx, principals.reviewer, await all());
    expect(d.pinned).toHaveLength(0);
  });

  it("最近開いた制作物は同じ制作物を 1 行にし、上限を超えたら古いものから消す", async () => {
    const ctx = createInMemoryContext();
    const ids: string[] = [];
    for (let i = 0; i < homeListPolicy.keepRecent + 2; i++) {
      ids.push((await seedWork(ctx, { title: `W${i}` })).id);
      await recordWorkOpened(ctx, principals.creator, ids[i]!);
      ctx.clock.advance(1000);
    }
    await recordWorkOpened(ctx, principals.creator, ids[5]!);
    const rows = await ctx.home.listRecent(principals.creator.userId);
    expect(rows).toHaveLength(homeListPolicy.keepRecent);
    expect(rows[0]!.workId).toBe(ids[5]);
    expect(rows.some((r) => r.workId === ids[0])).toBe(false);
  });
});

describe("ダッシュボードの構成の保存（W-26 段階 2）", () => {
  it("保存した構成を使い、知らない ID は捨て、足りない節は末尾に足す。既定に戻せる", async () => {
    const { ctx, all } = await setup();
    const saved = await saveDashboardLayout(ctx, principals.creator, [
      { id: "mentions", visible: true, limit: 3 },
      { id: "submit", visible: false, limit: null },
      { id: "nope", visible: true, limit: 5 },
    ]);
    expect(saved.slice(0, 2)).toEqual<DashboardWidgetPref[]>([
      { id: "mentions", visible: true, limit: 3 },
      { id: "submit", visible: false, limit: null },
    ]);
    let d = await buildDashboard(ctx, principals.creator, await all());
    expect(d.customized).toBe(true);
    expect(d.layout[0]!.id).toBe("mentions");
    expect(d.layout.find((w) => w.id === ("nope" as never))).toBeUndefined();
    await resetDashboardLayout(ctx, principals.creator);
    d = await buildDashboard(ctx, principals.creator, await all());
    expect(d.customized).toBe(false);
    expect(d.layout[0]!.id).toBe("submit");
  });

  it("既定の構成はすべての節を並べ、持っている役割の節を先にする", () => {
    const l = defaultDashboardLayout(new Set(["approver"]));
    expect(l[0]!.id).toBe("finalize");
    expect(new Set(l.map((w) => w.id)).size).toBe(l.length);
    expect(l.every((w) => w.visible && w.limit === 5)).toBe(true);
  });
});

describe("制作物の一括登録", () => {
  const row = (title: string) => ({
    title,
    year: 100,
    purpose: "",
    category: "印刷物",
    mediaType: "pdf" as const,
    creatorIds: [principals.creator.userId],
    managerIds: [],
    approverId: principals.approver.userId,
    confidentiality: "normal" as const,
    notationCategories: ["A1"],
  });

  it("まとめて登録し、1 件ずつの登録と同じ監査に加えて一括の記録を残す", async () => {
    const ctx = createInMemoryContext();
    const deadlineAt = endOfJstDay(ctx.clock.now() + 10 * DAY);
    const created = await importWorks(ctx, principals.sysadmin, {
      rows: [row("一"), { ...row("二"), deadlineAt, legacyId: "X-2" }],
      source: "works.csv",
    });
    expect(created.map((w) => w.title)).toEqual(["一", "二"]);
    expect(created[1]).toMatchObject({ deadlineAt, legacyId: "X-2", lifecycle: "active" });
    // 一括登録では登録した管理者を主管に含めない（主管は CSV の「主管」列だけ。利用者決定 2026-10-15）
    expect(created[0]!.managerIds).not.toContain(principals.sysadmin.userId);
    expect(ctx.state.audit.filter((a) => a.operation === "create")).toHaveLength(2);
    expect(ctx.state.audit.find((a) => a.operation === "bulk_import")?.after).toMatchObject({
      count: 2,
      source: "works.csv",
    });
    const withManager = await importWorks(ctx, principals.sysadmin, {
      rows: [{ ...row("三"), managerIds: [principals.creator.userId] }],
    });
    expect(withManager[0]!.managerIds).toEqual([principals.creator.userId]);
  });

  it("登録の権限（works:create）が無い人・空の行は拒否する", async () => {
    const ctx = createInMemoryContext();
    const noPerm = { ...principals.manager, orgPermissions: [] };
    await expect(importWorks(ctx, noPerm, { rows: [row("一")] })).rejects.toThrow("forbidden");
    await expect(importWorks(ctx, principals.manager, { rows: [] })).rejects.toThrow(
      "work_import_invalid",
    );
    await expect(
      importWorks(ctx, principals.manager, { rows: [{ ...row("一"), approverId: "" }] }),
    ).rejects.toThrow("work_import_invalid");
  });
});
