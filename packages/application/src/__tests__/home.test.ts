import { endOfJstDay } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission, revokeWorkPermission } from "../usecases/acl.ts";
import { addRequiredCheck } from "../usecases/checks.ts";
import { postComment } from "../usecases/comments.ts";
import { buildDashboard, dashboardPolicy } from "../usecases/dashboard.ts";
import {
  homeListPolicy,
  isWorkPinned,
  listSubmitTargets,
  setWorkPinned,
} from "../usecases/home.ts";
import { listMyNotifications, REDACTED_NOTIFICATION } from "../usecases/notifications.ts";
import { changeWorkLifecycle, importWorks } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const DAY = 86_400_000;

async function setup() {
  const ctx = createInMemoryContext();
  const now = ctx.clock.now();
  // B は非公開（校正者には見えない。通常の制作物は委員の誰でも見られるため）
  const late = await seedWork(ctx, {
    title: "B 遅い納期",
    deadlineAt: now + 20 * DAY,
    confidentiality: "restricted",
  });
  const soon = await seedWork(ctx, { title: "A 近い納期", deadlineAt: now + 3 * DAY });
  const text = await seedWork(ctx, { title: "C 文章", mediaType: "document" });
  const held = await seedWork(ctx, { title: "D 保留" });
  await changeWorkLifecycle(ctx, principals.manager, { workId: held.id, to: "on_hold" });
  await grantWorkPermission(ctx, principals.sysadmin, {
    workId: soon.id,
    userIds: [principals.reviewer.userId],
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
    expect(d.mine.submit[0]!.note).toContain("第1版"); // 受付中の版を添える（文言は問わない）
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
    expect(reviewer.mine.checks).toHaveLength(1);
    expect(reviewer.mine.checks[0]!.note).toBeTruthy();
    expect(reviewer.roles).toMatchObject({ reviewer: 1, checker: 1, creator: 0 });

    const creator = await buildDashboard(ctx, principals.creator, await all());
    expect(creator.roles.creator).toBe(3);
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

  it("ピン留め。見られない制作物はピン留めできない", async () => {
    const { ctx, soon, late, all } = await setup();
    await setWorkPinned(ctx, principals.reviewer, { workId: soon.id, pinned: true });
    await expect(
      setWorkPinned(ctx, principals.reviewer, { workId: late.id, pinned: true }),
    ).rejects.toThrow("forbidden");
    let d = await buildDashboard(ctx, principals.reviewer, await all());
    expect(d.pinned.map((i) => i.workTitle)).toEqual(["A 近い納期"]);
    await setWorkPinned(ctx, principals.reviewer, { workId: soon.id, pinned: false });
    d = await buildDashboard(ctx, principals.reviewer, await all());
    expect(d.pinned).toHaveLength(0);
  });
});

describe("ピン留めは制作物の購読（利用者決定 2026-10-27）", () => {
  const submitted = async (
    ctx: ReturnType<typeof createInMemoryContext>,
    who: (typeof principals)[keyof typeof principals],
  ) => (await listMyNotifications(ctx, who)).filter((n) => n.kind === "revision_submitted");

  it("版提出の通知は出さない（2026-10-30 合意。ピン留めしていても revision_submitted は作らない）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await setWorkPinned(ctx, principals.stranger, { workId: work.id, pinned: true });
    await submitRevision(ctx, work.id);
    await submitRevision(ctx, work.id);
    expect(await submitted(ctx, principals.stranger)).toHaveLength(0);
    expect(await submitted(ctx, principals.manager)).toHaveLength(0);
  });

  it.skip("旧: ピン留めした人は版提出の通知を受け取る", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await submitRevision(ctx, work.id);
    expect(await submitted(ctx, principals.stranger)).toHaveLength(0);
    await setWorkPinned(ctx, principals.stranger, { workId: work.id, pinned: true });
    await setWorkPinned(ctx, principals.approver, { workId: work.id, pinned: true });
    await setWorkPinned(ctx, principals.creator, { workId: work.id, pinned: true });

    const second = await submitRevision(ctx, work.id);
    const got = await submitted(ctx, principals.stranger);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ workId: work.id, revisionId: second.id });
    expect(got[0]!.title).not.toBe(REDACTED_NOTIFICATION.title);
    expect(await submitted(ctx, principals.approver)).toHaveLength(2);
    expect(await submitted(ctx, principals.creator)).toHaveLength(0);

    await setWorkPinned(ctx, principals.stranger, { workId: work.id, pinned: false });
    await submitRevision(ctx, work.id);
    expect(await submitted(ctx, principals.stranger)).toHaveLength(1);
  });

  it.skip("非公開の制作物は、ピン留めした後に見られなくなった人には伏せた通知を送る", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { title: "極秘ポスター", confidentiality: "restricted" });
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.stranger.userId],
      permission: "view",
    });
    await setWorkPinned(ctx, principals.stranger, { workId: work.id, pinned: true });
    await submitRevision(ctx, work.id);
    const [shown] = await submitted(ctx, principals.stranger);
    expect(shown?.body).toContain("極秘ポスター");

    await revokeWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userId: principals.stranger.userId,
    });
    const second = await submitRevision(ctx, work.id);
    const stored = ctx.state.notifications
      .all()
      .filter((n) => n.recipientId === principals.stranger.userId && n.revisionId === second.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      kind: "revision_submitted",
      title: REDACTED_NOTIFICATION.title,
      body: REDACTED_NOTIFICATION.body,
    });
  });

  it("ピン留めは 100 件まで。超えたら古いものから外す", async () => {
    const ctx = createInMemoryContext();
    const works = [];
    for (let i = 0; i <= 100; i++) works.push(await seedWork(ctx, { title: `制作物 ${i}` }));
    for (const w of works) {
      ctx.clock.advance(1000);
      await setWorkPinned(ctx, principals.stranger, { workId: w.id, pinned: true });
    }
    const pinned = [];
    for (const w of works)
      if (await isWorkPinned(ctx, principals.stranger, w.id)) pinned.push(w.title);
    expect(homeListPolicy.maxPins).toBe(100);
    expect(pinned).toHaveLength(100);
    expect(pinned).not.toContain("制作物 0");
    expect(pinned).toContain("制作物 100");
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
    approverIds: [principals.approver.userId],
    confidentiality: "normal" as const,
    notationCategories: ["A1"],
    productionTeamIds: [],
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
    // 校了者を決める権限（approvers:assign）が無い人も、登録できない
    const createOnly = { ...principals.manager, orgPermissions: ["works:create"] };
    await expect(importWorks(ctx, createOnly, { rows: [row("一")] })).rejects.toThrow("forbidden");
    await expect(importWorks(ctx, principals.manager, { rows: [] })).rejects.toThrow(
      "work_import_invalid",
    );
    await expect(
      importWorks(ctx, principals.manager, { rows: [{ ...row("一"), approverIds: [""] }] }),
    ).rejects.toThrow("work_import_invalid");
  });
});
