import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, HOUR, type Harness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

const NOW = Date.UTC(2026, 10, 1, 9, 0, 0);
const pdf = [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" as const }];

afterEach(() => {
  vi.useRealTimers();
});

async function unreadOf(t: Harness, userId: string): Promise<number> {
  return t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("notifications")
          .withIndex("by_recipient_read_created", (q) =>
            q.eq("recipientId", userId).eq("readAt", undefined),
          )
          .collect()
      ).length,
  );
}

describe("Convex 統合: 通知の認可（§5.2-10）", () => {
  it("非公開の制作物: 閲覧 ACL の無い人への割当通知と、ACL 取消後の既存通知は作品名・確認観点を返さない", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, {
      title: "極秘ポスター",
      confidentiality: "restricted",
    });
    await submitFiles(cast, workId, pdf);
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.stranger.id, cast.reviewer.id],
    });
    // stranger は ACL も職責も無い（作品は forbidden）
    const strangers = await cast.stranger.as.query(api.notifications.list, {});
    expect(strangers).toHaveLength(1);
    expect(JSON.stringify(strangers)).not.toContain("極秘ポスター");
    expect(strangers[0]).toMatchObject({
      kind: "review_assigned",
      title: "閲覧できない制作物の通知です",
    });
    expect(strangers[0]).not.toHaveProperty("workId");

    const before = await cast.reviewer.as.query(api.notifications.list, {});
    expect(before[0]?.body).toContain("極秘ポスター");
    await cast.admin.as.mutation(api.acl.revoke, {
      workId,
      userId: cast.reviewer.id,
    });
    const after = await cast.reviewer.as.query(api.notifications.list, {});
    expect(JSON.stringify(after)).not.toContain("極秘ポスター");
    expect(after[0]).not.toHaveProperty("workId");
    expect(after[0]).not.toHaveProperty("revisionId");
  });
});

describe("Convex 統合: すべて既読（未読の索引で続きまで処理する）", () => {
  it("未読 201 件: 1 回目は 200 件を既読にし、続きは予約された処理で 0 件になる", async () => {
    vi.useFakeTimers({ now: NOW });
    const t = createHarness();
    const cast = await createCast(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 201; i++)
        await ctx.db.insert("notifications", {
          recipientId: cast.reviewer.id,
          kind: "rule_proposed",
          title: "表記ルールの提案",
          body: `提案 ${i}`,
          createdAt: NOW - (201 - i) * 1000,
        });
    });
    expect(await cast.reviewer.as.mutation(api.notifications.markAllRead, {})).toBe(200);
    expect(await unreadOf(t, cast.reviewer.id)).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await unreadOf(t, cast.reviewer.id)).toBe(0);
  });
});

describe("Convex 統合: 期限接近リマインドの対象", () => {
  it("先頭に古い未確認割当が 500 件あっても、現行の割当に通知が届く", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const old = await submitFiles(cast, workId, pdf);
    // 古い版: 受付終了済みだが、未確認（pending/viewed）の割当が残っている
    await t.run(async (ctx) => {
      for (let i = 0; i < 500; i++)
        await ctx.db.insert("reviewAssignments", {
          revisionId: old.revisionId,
          reviewerId: `old-${i}`,
          reviewType: "general",
          state: i % 2 ? "viewed" : "pending",
        });
      await ctx.db.patch(old.revisionId, {
        reviewState: "closed",
        reviewClosedReason: "deadline",
        reviewClosedAt: NOW,
      });
    });
    await submitFiles(cast, workId, pdf); // 締切は 48 時間後
    await cast.manager.as.mutation(api.reviews.setReviewers, {
      workId,
      reviewerIds: [cast.reviewer.id],
    });
    vi.setSystemTime(Date.UTC(2026, 10, 2, 15, 0, 0)); // 締切日（JST）の 0:00（48h 後提出の当日）
    expect(await t.mutation(internal.revisions.remindDeadlines, {})).toBe(1);
    expect(await t.mutation(internal.revisions.remindDeadlines, {})).toBe(0);
    const notes = await cast.reviewer.as.query(api.notifications.list, {});
    expect(notes.filter((n) => n.kind === "deadline_approaching")).toHaveLength(1);
  });

  it("期限内の受付中の版が 1 回分（100 件）を超えても、続きを予約して全員に届く", async () => {
    vi.useFakeTimers({ now: NOW });
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const first = await submitFiles(cast, workId, pdf);
    await t.run(async (ctx) => {
      const doc = (await ctx.db.get(first.revisionId))!;
      const { _id, _creationTime, ...fields } = doc;
      void _id;
      void _creationTime;
      const ids: Id<"revisions">[] = [first.revisionId];
      for (let i = 0; i < 149; i++) ids.push(await ctx.db.insert("revisions", fields));
      for (const revisionId of ids)
        await ctx.db.insert("reviewAssignments", {
          revisionId,
          reviewerId: cast.reviewer.id,
          reviewType: "general",
          state: "pending",
        });
    });
    vi.setSystemTime(Date.UTC(2026, 10, 2, 15, 0, 0));
    expect(await t.mutation(internal.revisions.remindDeadlines, {})).toBe(100);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const sent = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("notifications")
            .withIndex("by_recipient", (q) => q.eq("recipientId", cast.reviewer.id))
            .collect()
        ).filter((n) => n.kind === "deadline_approaching").length,
    );
    expect(sent).toBe(150);
  });
});
