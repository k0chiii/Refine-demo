import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness, createUser, HOUR, type TestUser } from "../test/harness";
import { profileReads, type ReadProfile } from "../test/readProfile";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createAppContext } from "./lib/adapters";
import { syncWorkSummary } from "./lib/workSummary";

/**
 * 読み取りの量（Convex のデータベース帯域）の計測と、その上限の見張り。
 * 本番の上位の問い合わせ（revisions.get・dashboard.*・works.listMinePage・notifications.list ほか）を、
 * 現実的な量のデータで 1 回ずつ実行し、読んだドキュメント数・バイト数・表ごとの内訳を出す。
 * - 既定は小さな規模で、上限（予算）を assert する。`READ_PROBE_SCALE=medium|full` で本番に近い量（60 / 120 制作物。full は convex-test が遅く数十分かかる）にして表を出す
 * - 出力は `READ_PROBE_OUT=パス` に JSON で書く（比べるため）。計測の注意点は test/readProfile.ts
 */
const SHAPES = {
  small: { works: 24, revisions: 3, latestThreads: 10, olderThreads: 2, creators: 6, reviewers: 6 },
  medium: {
    works: 60,
    revisions: 4,
    latestThreads: 20,
    olderThreads: 3,
    creators: 8,
    reviewers: 8,
  },
  full: {
    works: 120,
    revisions: 4,
    latestThreads: 24,
    olderThreads: 4,
    creators: 12,
    reviewers: 10,
  },
} as const;
const SCALE: keyof typeof SHAPES =
  process.env.READ_PROBE_SCALE === "full" || process.env.READ_PROBE_SCALE === "medium"
    ? process.env.READ_PROBE_SCALE
    : "small";
const shape = SHAPES[SCALE];

const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

interface Seeded {
  t: ReturnType<typeof createHarness>;
  heavyCreator: TestUser;
  heavyReviewer: TestUser;
  approver: TestUser;
  /** heavyCreator の制作物で、受付中の版に未解決の指摘がある 1 件 */
  openWork: { revisionId: Id<"revisions">; previousRevisionId: Id<"revisions"> };
}

async function seed(): Promise<Seeded> {
  const t = createHarness();
  const cast = await createCast(t);
  const creators: TestUser[] = [cast.creator];
  for (let i = 1; i < shape.creators; i++) creators.push(await createUser(t, `creator${i}`));
  const reviewers: TestUser[] = [cast.reviewer];
  for (let i = 1; i < shape.reviewers; i++) reviewers.push(await createUser(t, `reviewer${i}`));

  let openWork: Seeded["openWork"] | null = null;
  for (let w = 0; w < shape.works; w++) {
    const creator = creators[w % creators.length]!;
    // 校正者は 3 人。heavyReviewer は 3 件に 1 件に入る（よく校正する人）
    const roster = [0, 1, 2].map((k) => reviewers[(w * 3 + k + 1) % reviewers.length]!);
    if (w % 3 === 0) roster[0] = cast.reviewer;
    const unique = [...new Map(roster.map((r) => [r.id, r])).values()];
    const workId = (await cast.manager.as.mutation(api.works.create, {
      title: `制作物${w}`,
      purpose: "来場者案内",
      category: "印刷物",
      mediaType: "pdf",
      year: 100,
      creatorIds: [creator.id],
      approverId: cast.approver.id,
      reviewerIds: unique.map((r) => r.id),
    })) as Id<"works">;
    await cast.admin.as.mutation(api.acl.grant, {
      workId,
      userIds: unique.map((r) => r.id),
      permission: "review",
    });
    let previous: Id<"revisions"> | null = null;
    for (let r = 0; r < shape.revisions; r++) {
      vi.setSystemTime(Date.now() + HOUR);
      const prepared = await creator.as.mutation(api.submissions.prepare, {
        workId,
        kind: "standard",
        reviewType: "general",
        deadlineAt: Date.now() + 48 * HOUR,
        changeSummary: "提出",
        focusNotes: "",
        items: pdf.map((i) => ({ ...i, role: "source" as const })),
      });
      const { uploadVerified } = await import("../test/harness");
      for (const [k, it] of prepared.items.entries())
        if (it.keyPrefix !== null)
          await uploadVerified(creator, it.id, { size: 10 + k, sha256: `sha-${w}-${r}-${k}` });
      const confirmed = await creator.as.mutation(api.submissions.confirm, {
        sessionId: prepared.sessionId as Id<"uploadSessions">,
      });
      const revisionId = confirmed.revisionId as Id<"revisions">;
      const last = r === shape.revisions - 1;
      const threads = last ? shape.latestThreads : shape.olderThreads;
      const threadIds: Id<"commentThreads">[] = [];
      for (let k = 0; k < threads; k++) {
        const author = unique[k % unique.length]!;
        threadIds.push(
          (await author.as.mutation(api.comments.post, {
            revisionId,
            body: `指摘${k}: 団体名の表記が揃っていません。ご確認ください。`,
            kind: "correction",
            severity: "info",
          })) as Id<"commentThreads">,
        );
      }
      // 返信は 3 件に 1 件。解決は 4 件に 1 件
      for (const [k, id] of threadIds.entries()) {
        vi.setSystemTime(Date.now() + 1000);
        if (k % 3 === 0)
          await creator.as.mutation(api.comments.reply, { threadId: id, body: "対応します" });
        if (k % 4 === 0)
          await creator.as.mutation(api.comments.decide, {
            threadId: id,
            action: "accepted",
          });
      }
      // 受付中のまま残すのは進行中の制作物（4 割）の最新の版だけ。古い版の校正者は、heavyReviewer を除いて完了する
      if (!last)
        for (const rv of unique)
          if (rv.id !== cast.reviewer.id || (w + r) % 3 !== 0)
            await rv.as.mutation(api.reviews.complete, { revisionId });
      if (last && w % 5 < 2 && w % 4 === 0)
        await cast.manager.as.mutation(api.checks.add, {
          revisionId,
          type: "photo",
          assigneeId: cast.reviewer.id,
        });
      if (last && creator.id === cast.creator.id && openWork === null && previous && w % 5 < 2)
        openWork = { revisionId, previousRevisionId: previous };
      previous = revisionId;
    }
    // 4 割を進行中のまま残し、残りは校了・保留・中止にする（受付中の版は閉じる）
    if (w % 5 >= 2) {
      await t.run(async (ctx) => {
        const lifecycle = w % 5 === 2 ? "on_hold" : "finalized";
        await ctx.db.patch(workId, { lifecycle });
        // 受付中の版を閉じるのは、本番と同じ経路（アダプタの revisions.update）で行う
        const app = createAppContext(ctx);
        for (const rev of await app.revisions.listByWork(workId))
          if (rev.reviewState === "open")
            await app.revisions.update({
              ...rev,
              reviewState: "closed",
              reviewClosedReason: "deadline",
              reviewClosedAt: Date.now(),
            });
        await syncWorkSummary(ctx.db, workId);
      });
    }
  }
  if (!openWork) throw new Error("probe: openWork を作れなかった");
  // 本番で埋め直し（rebuildWorkCounters）を流したあとの状態にする
  await t.mutation(internal.migrations.rebuildWorkCounters, {});
  return {
    t,
    heavyCreator: cast.creator,
    heavyReviewer: cast.reviewer,
    approver: cast.approver,
    openWork,
  };
}

const results: Record<string, ReadProfile> = {};
let world: Seeded;

beforeAll(async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  world = await seed();
}, 600_000);

afterAll(() => {
  vi.useRealTimers();
  const rows = Object.entries(results).map(
    ([name, r]) =>
      `${name.padEnd(34)} docs=${String(r.docs).padStart(5)} KB=${(r.bytes / 1024).toFixed(1).padStart(7)}  ` +
      Object.entries(r.byTable)
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .slice(0, 6)
        .map(([k, v]) => `${k}:${v.docs}/${(v.bytes / 1024).toFixed(1)}K`)
        .join(" "),
  );
  console.log(`\n[read probe: ${SCALE}]\n${rows.join("\n")}\n`);
  const out = process.env.READ_PROBE_OUT;
  if (out) {
    writeFileSync(out, JSON.stringify({ scale: SCALE, shape, results }, null, 2));
    writeFileSync(`${out}.txt`, `${rows.join("\n")}\n`);
  }
});

async function probe<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const { result, ...profile } = await profileReads(fn);
  results[name] = profile;
  return result;
}

describe("読み取りの量（計測）", () => {
  it("revisions.get（受付中の版 / 前の版）", async () => {
    const { heavyReviewer, openWork } = world;
    await probe("revisions.get (latest)", () =>
      heavyReviewer.as.query(api.revisions.get, { revisionId: openWork.revisionId }),
    );
    await probe("revisions.get (older)", () =>
      heavyReviewer.as.query(api.revisions.get, { revisionId: openWork.previousRevisionId }),
    );
  });

  it("presence.heartbeat / works.get", async () => {
    const { heavyReviewer, openWork } = world;
    const detail = await heavyReviewer.as.query(api.revisions.get, {
      revisionId: openWork.revisionId,
    });
    const workId = detail.work.id;
    // 1 回目は部屋・利用者の行を作る。2 回目以降（定常の心拍）を測る
    await heavyReviewer.as.mutation(api.presence.heartbeat, {
      workId,
      sessionId: crypto.randomUUID(),
    });
    const sessionId = crypto.randomUUID();
    await heavyReviewer.as.mutation(api.presence.heartbeat, { workId, sessionId });
    await probe("presence.heartbeat (steady)", () =>
      heavyReviewer.as.mutation(api.presence.heartbeat, { workId, sessionId }),
    );
    await probe("works.get", () => heavyReviewer.as.query(api.works.get, { workId }));
  });

  it("dashboard.*", async () => {
    const { heavyReviewer, heavyCreator } = world;
    await probe("dashboard.works (creator)", () => heavyCreator.as.query(api.dashboard.works, {}));
    await probe("dashboard.check (reviewer)", () =>
      heavyReviewer.as.query(api.dashboard.check, {}),
    );
    await probe("dashboard.make (creator)", () => heavyCreator.as.query(api.dashboard.make, {}));
    await probe("dashboard.checkBadge (reviewer)", () =>
      heavyReviewer.as.query(api.dashboard.checkBadge, {}),
    );
  });

  it("works.listMinePage / home.submitTargets / notifications.list / carryCandidates", async () => {
    const { heavyReviewer, heavyCreator, openWork } = world;
    await probe("works.listMinePage (1 page of 50)", () =>
      heavyReviewer.as.query(api.works.listMinePage, {
        paginationOpts: { numItems: 50, cursor: null },
      }),
    );
    await probe("works.listMinePage (all pages)", async () => {
      let cursor: string | null = null;
      for (;;) {
        const page: { isDone: boolean; continueCursor: string } = await heavyReviewer.as.query(
          api.works.listMinePage,
          { paginationOpts: { numItems: 50, cursor } },
        );
        if (page.isDone) return;
        cursor = page.continueCursor;
      }
    });
    await probe("home.submitTargets (creator)", () =>
      heavyCreator.as.query(api.home.submitTargets, {}),
    );
    await probe("notifications.list (creator)", () =>
      heavyCreator.as.query(api.notifications.list, { limit: 20 }),
    );
    await probe("comments.carryCandidates (creator)", () =>
      heavyCreator.as.query(api.comments.carryCandidates, { revisionId: openWork.revisionId }),
    );
    expect(Object.keys(results).length).toBeGreaterThan(5);
  });

  it("見張り: 閉じた版の文書・割当は読まない（校正のバッジ・校正の入口）。持ち越し候補は版を読み直さない", () => {
    // 受付中でない版の割当は pending / viewed のまま残る。印（revisionOpen）の索引で引けば、その版の文書は読まない
    expect(results["dashboard.checkBadge (reviewer)"]!.byTable.revisions).toBeUndefined();
    expect(results["dashboard.check (reviewer)"]!.byTable.revisions).toBeUndefined();
    // 版の一覧（受付中でない前版を探す 1 回）と対象の版の 1 件だけ
    expect(results["comments.carryCandidates (creator)"]!.byTable.revisions!.docs).toBe(
      shape.revisions + 1,
    );
  });

  it("見張り: 全体の状況は割当・専門確認を読まず、一覧は要約を読まず、通知はスレッドを読まず、許可は読み捨てない", () => {
    // 進み具合の行（workProgress）・一覧の行（workListCards）・削除済みスレッドの索引で足りるもの
    expect(results["dashboard.works (creator)"]!.byTable.reviewAssignments).toBeUndefined();
    expect(results["dashboard.works (creator)"]!.byTable.requiredChecks).toBeUndefined();
    expect(results["works.listMinePage (1 page of 50)"]!.byTable.workSummaries).toBeUndefined();
    expect(results["home.submitTargets (creator)"]!.byTable.workSummaries).toBeUndefined();
    expect(results["notifications.list (creator)"]!.byTable.commentThreads).toBeUndefined();
    // 校正者の review の許可は、edit 以上の候補を探すために読まない（索引の範囲に入らない）
    expect(results["dashboard.check (reviewer)"]!.byTable.workPermissions).toBeUndefined();
    // 版の画面は本人に当たる許可だけ（職責も許可も無い校正者の許可は 1 件）
    expect(
      results["revisions.get (latest)"]!.byTable.workPermissions?.docs ?? 0,
    ).toBeLessThanOrEqual(1);
  });

  it("印が無い古い割当（移行の前）でも結果は同じで、読む量は移行前の水準（比べる用に記録）", async () => {
    const { t, heavyReviewer } = world;
    const before = await heavyReviewer.as.query(api.dashboard.checkBadge, {});
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("reviewAssignments").collect())
        await ctx.db.patch(row._id, { revisionOpen: undefined });
    });
    const after = await probe("dashboard.checkBadge (reviewer, 印なし)", () =>
      heavyReviewer.as.query(api.dashboard.checkBadge, {}),
    );
    expect(after).toEqual(before);
    await probe("dashboard.check (reviewer, 印なし)", () =>
      heavyReviewer.as.query(api.dashboard.check, {}),
    );
  });
});
