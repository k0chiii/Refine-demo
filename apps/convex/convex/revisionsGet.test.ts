import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { THREAD_RECENT_EVENTS_READ } from "@mf100/application";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness, HOUR } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";
import { loadGroupNames } from "./lib/threadActivity";

/**
 * 版の画面（revisions.get）の読み取りを絞ったこと（直近の返信・受付中の版・グループの名前）で、結果が変わらないことの確かめ。
 * 読む量そのものは application の readCost.test.ts が見ている。
 */
const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

describe("Convex 統合: 版の画面の読み取りを絞っても結果は同じ", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("返信の多いスレッドの直近の返信は、削除された返信を除いた最後の 3 件（古い順）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const { revisionId } = await submitFiles(cast, workId, pdf);
    const threadId = (await cast.reviewer.as.mutation(api.comments.post, {
      revisionId,
      body: "団体名が誤り",
      kind: "correction",
      severity: "info",
    })) as Id<"commentThreads">;
    const total = THREAD_RECENT_EVENTS_READ + 2;
    for (let i = 1; i <= total; i++) {
      vi.setSystemTime(Date.now() + 1000);
      await cast.creator.as.mutation(api.comments.reply, { threadId, body: `返信${i}` });
    }
    const replies = (await cast.reviewer.as.query(api.comments.events, { threadId })).events.filter(
      (e) => e.eventType === "replied",
    );
    vi.setSystemTime(Date.now() + 1000);
    await cast.creator.as.mutation(api.comments.removeReply, {
      threadId,
      replyEventId: replies.at(-1)!.id,
    });
    const thread = (await cast.reviewer.as.query(api.revisions.get, { revisionId })).threads.find(
      (x) => x.id === threadId,
    )!;
    expect(thread.replyCount).toBe(total - 1);
    expect(thread.latestReplies.map((r) => r.body)).toEqual([
      `返信${total - 3}`,
      `返信${total - 2}`,
      `返信${total - 1}`,
    ]);
  });

  it("前の版を開くと、受付中の版（新しい版）を返す。制作物の要約が無い古い制作物でも同じ", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const first = await submitFiles(cast, workId, pdf);
    vi.setSystemTime(Date.now() + HOUR);
    const second = await submitFiles(cast, workId, pdf);

    const latest = await cast.reviewer.as.query(api.revisions.get, {
      revisionId: second.revisionId,
    });
    expect(latest.acceptingRevisionId).toBe(second.revisionId);
    expect(latest.can.comment).toBe(true);
    const old = await cast.reviewer.as.query(api.revisions.get, { revisionId: first.revisionId });
    expect(old.acceptingRevisionId).toBe(second.revisionId);
    expect(old.can.comment).toBe(false);

    // 要約の行が無い（揃う前の）制作物は、版から探す
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("workSummaries")
        .withIndex("by_work", (q) => q.eq("workId", workId))
        .collect();
      for (const r of rows) await ctx.db.delete(r._id);
    });
    const legacy = await cast.reviewer.as.query(api.revisions.get, {
      revisionId: first.revisionId,
    });
    expect(legacy.acceptingRevisionId).toBe(second.revisionId);
    expect(legacy.commentBlockedReason).toBe(old.commentBlockedReason);
  });

  it("グループの名前は、メンションしたグループだけを引く。消えたグループ・グループの ID でないものは入らない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const keep = await cast.admin.as.mutation(api.groups.save, { name: "こうせい", memberIds: [] });
    const other = await cast.admin.as.mutation(api.groups.save, {
      name: "こうほう",
      memberIds: [],
    });
    const gone = await cast.admin.as.mutation(api.groups.save, { name: "消す", memberIds: [] });
    await cast.admin.as.mutation(api.groups.remove, { id: gone });
    const names = await t.run(async (ctx) => [
      ...(await loadGroupNames(ctx.db, [keep, keep, gone, "not-an-id", cast.creator.id])),
    ]);
    expect(names).toEqual([[keep, "こうせい"]]);
    expect(names.some(([id]) => id === other)).toBe(false);
    expect(await t.run(async (ctx) => (await loadGroupNames(ctx.db, [])).size)).toBe(0);
  });
});
