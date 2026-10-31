import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness, HOUR, uploadVerified, type Harness } from "../test/harness";
import { revisionThreadStatsFromRevision } from "@mf100/domain";

/**
 * works.get の commentThreads 読み取り削減（docs/COST.md 推奨 3）。
 * 指標: 版 1 件あたりの commentThreads 文書読み取り数。
 * フィクスチャのスレッド数 = 変更前に必ず読んでいた文書数。変更後は版の派生件数があれば 0。
 */
const THREADS = 40;

async function setupWork(t: Harness) {
  const cast = await createCast(t);
  const workId = (await cast.manager.as.mutation(api.works.create, {
    title: "件数の計測",
    purpose: "perf",
    category: "印刷物",
    mediaType: "pdf",
    year: 100,
    creatorIds: [cast.creator.id],
    approverId: cast.approver.id,
  })) as Id<"works">;
  await cast.admin.as.mutation(api.acl.grant, {
    workId,
    userIds: [cast.reviewer.id],
    permission: "review",
  });
  const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
    workId,
    kind: "standard",
    reviewType: "general",
    deadlineAt: Date.now() + 24 * HOUR,
    changeSummary: "初稿",
    focusNotes: "配色",
    items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
  });
  await uploadVerified(cast.creator, prepared.items[0]!.id, { size: 10, sha256: "a" });
  const { revisionId } = await cast.creator.as.mutation(api.submissions.confirm, {
    sessionId: prepared.sessionId as Id<"uploadSessions">,
  });
  return { cast, workId, revisionId: revisionId as Id<"revisions"> };
}

describe("works.get thread stats (perf)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it(`投稿 ${THREADS} 件後、版に件数が揃い works.get はスレッド全読みなしで同じ未解決数を返す`, async () => {
    const t = createHarness();
    const { cast, workId, revisionId } = await setupWork(t);

    for (let i = 0; i < THREADS; i++) {
      await cast.reviewer.as.mutation(api.comments.post, {
        revisionId,
        body: `指摘 ${i}`,
        kind: "correction",
        severity: "info",
      });
    }

    const threadDocs = await t.run(async (ctx) =>
      ctx.db
        .query("commentThreads")
        .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
        .collect(),
    );
    // 変更前の works.get は、削除されていない分だけこの件数を毎回復帰で読んでいた
    const baselineThreadDocsRead = threadDocs.filter((d) => d.deletedAt === undefined).length;
    expect(baselineThreadDocsRead).toBe(THREADS);

    const revision = await t.run(async (ctx) => ctx.db.get(revisionId));
    expect(revision).toMatchObject({
      unresolvedCount: THREADS,
      openBotCount: 0,
      threadCount: THREADS,
    });
    // 派生件数が揃っている → works.get は listByRevision を呼ばない
    expect(revisionThreadStatsFromRevision(revision!)).toEqual({
      unresolved: THREADS,
      openBot: 0,
      total: THREADS,
    });

    const detail = await cast.reviewer.as.query(api.works.get, { workId });
    const row = detail.revisions.find((r) => r.id === revisionId);
    expect(row?.unresolvedCount).toBe(THREADS);
    expect(row?.openBotCount).toBe(0);

    // 古い行（件数なし）は従来どおりスレッドから数える
    await t.run(async (ctx) => {
      await ctx.db.patch(revisionId, {
        unresolvedCount: undefined,
        openBotCount: undefined,
        threadCount: undefined,
      });
    });
    expect(
      revisionThreadStatsFromRevision((await t.run((ctx) => ctx.db.get(revisionId)))!),
    ).toBeNull();
    const fallback = await cast.reviewer.as.query(api.works.get, { workId });
    expect(fallback.revisions.find((r) => r.id === revisionId)?.unresolvedCount).toBe(THREADS);
  });
});
