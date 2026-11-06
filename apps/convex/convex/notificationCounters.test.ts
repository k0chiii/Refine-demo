import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, type Harness } from "../test/harness";

const NOW = Date.UTC(2026, 10, 6, 9, 0, 0);

afterEach(() => {
  vi.useRealTimers();
});

/** 利用者ごとの未読の数の行（notificationCounters）。無ければ null */
async function counterOf(t: Harness, userId: string): Promise<number | null> {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query("notificationCounters")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return row?.unread ?? null;
  });
}

/** 通知を ctx.db へ直接入れる（移行前の行・大量の行を用意する。数の行は触らない） */
async function insertDirect(
  t: Harness,
  userId: string,
  count: number,
  opts: { read?: boolean; threadId?: string } = {},
): Promise<void> {
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++)
      await ctx.db.insert("notifications", {
        recipientId: userId,
        kind: "rule_proposed",
        title: "表記ルールの提案",
        body: `提案 ${i}`,
        createdAt: NOW - (count - i) * 1000,
        ...(opts.read ? { readAt: NOW } : {}),
        ...(opts.threadId ? { threadId: opts.threadId } : {}),
      });
  });
}

async function setCounter(t: Harness, userId: string, unread: number): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("notificationCounters", { userId, unread });
  });
}

describe("Convex 統合: 未読の数は利用者ごとの数の行から読む", () => {
  it("通知を作ると数が増え、既読・未読に戻すで増減する（数の行は最初の書込みで作る）", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const t = createHarness();
    const cast = await createCast(t);
    const me = cast.reviewer;
    expect(await counterOf(t, me.id)).toBeNull();

    await me.as.mutation(api.notifications.sendTest, {});
    expect(await counterOf(t, me.id)).toBe(1);
    expect(await me.as.query(api.notifications.unreadCount, {})).toBe(1);

    vi.setSystemTime(NOW + 61_000);
    await me.as.mutation(api.notifications.sendTest, {});
    expect(await counterOf(t, me.id)).toBe(2);

    const [latest] = await me.as.query(api.notifications.list, {});
    const id = latest!.id as Id<"notifications">;
    await me.as.mutation(api.notifications.markRead, { notificationId: id });
    expect(await me.as.query(api.notifications.unreadCount, {})).toBe(1);
    // 既読のものをもう一度既読にしても数は変わらない
    await me.as.mutation(api.notifications.markRead, { notificationId: id });
    expect(await counterOf(t, me.id)).toBe(1);

    await me.as.mutation(api.notifications.markUnread, { notificationId: id });
    expect(await me.as.query(api.notifications.unreadCount, {})).toBe(2);
    await me.as.mutation(api.notifications.markUnread, { notificationId: id });
    expect(await counterOf(t, me.id)).toBe(2);
    // 他人の数は変わらない
    expect(await cast.approver.as.query(api.notifications.unreadCount, {})).toBe(0);
  });

  it("スレッドを開くと、そのスレッドの未読の分だけ減る", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const t = createHarness();
    const cast = await createCast(t);
    const me = cast.reviewer;
    await insertDirect(t, me.id, 2, { threadId: "thread-a" });
    await insertDirect(t, me.id, 1, { threadId: "thread-b" });
    await setCounter(t, me.id, 3);

    expect(await me.as.mutation(api.notifications.markThreadRead, { threadId: "thread-a" })).toBe(
      2,
    );
    expect(await counterOf(t, me.id)).toBe(1);
    expect(await me.as.query(api.notifications.unreadCount, {})).toBe(1);
  });

  it("すべて既読: 1 回目と予約された続きで 0 まで減る（数の行がある利用者）", async () => {
    vi.useFakeTimers({ now: NOW });
    const t = createHarness();
    const cast = await createCast(t);
    const me = cast.reviewer;
    await insertDirect(t, me.id, 201);
    await setCounter(t, me.id, 201);
    expect(await me.as.query(api.notifications.unreadCount, {})).toBe(201);

    expect(await me.as.mutation(api.notifications.markAllRead, {})).toBe(200);
    expect(await counterOf(t, me.id)).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await counterOf(t, me.id)).toBe(0);
    expect(await me.as.query(api.notifications.unreadCount, {})).toBe(0);
  });

  it("数の行が無い（移行前）: 従来どおり 100 件までを数え、数え切れる時点で行を作る", async () => {
    vi.useFakeTimers({ now: NOW });
    const t = createHarness();
    const cast = await createCast(t);
    const me = cast.reviewer;
    await insertDirect(t, me.id, 201);
    expect(await me.as.query(api.notifications.unreadCount, {})).toBe(100);

    await me.as.mutation(api.notifications.markAllRead, {});
    // 残り 1 件は数えられるので行を作るかどうかによらず 1
    expect(await me.as.query(api.notifications.unreadCount, {})).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await counterOf(t, me.id)).toBe(0);
    expect(await me.as.query(api.notifications.unreadCount, {})).toBe(0);
  });

  it("数の行が無く未読が少なければ、数えた値を返す（query は行を作らない）", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const t = createHarness();
    const cast = await createCast(t);
    await insertDirect(t, cast.reviewer.id, 3);
    await insertDirect(t, cast.reviewer.id, 2, { read: true });
    expect(await cast.reviewer.as.query(api.notifications.unreadCount, {})).toBe(3);
    expect(await counterOf(t, cast.reviewer.id)).toBeNull();
  });

  it("移行 backfillNotificationCounters: 利用者ごとの未読を数え直して行を書く（冪等）", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const t = createHarness();
    const cast = await createCast(t);
    await insertDirect(t, cast.reviewer.id, 150);
    await insertDirect(t, cast.reviewer.id, 2, { read: true });
    await setCounter(t, cast.approver.id, 9); // ずれた行は直す
    await insertDirect(t, cast.manager.id, 1);

    for (const reset of [false, true]) {
      await t.mutation(internal.migrations.backfillNotificationCounters, {
        cursor: null,
        batchSize: 100,
        oneBatchOnly: true,
        ...(reset ? { reset: true } : {}),
      });
      expect(await counterOf(t, cast.reviewer.id)).toBe(150);
      expect(await counterOf(t, cast.approver.id)).toBe(0);
      expect(await counterOf(t, cast.manager.id)).toBe(1);
      expect(await counterOf(t, cast.stranger.id)).toBe(0);
    }
    // 行があれば 100 件を超えても数どおり（バッジは 999+ まで出す）
    expect(await cast.reviewer.as.query(api.notifications.unreadCount, {})).toBe(150);
    const rows = await t.run((ctx) => ctx.db.query("notificationCounters").collect());
    expect(rows.filter((r) => r.userId === cast.reviewer.id)).toHaveLength(1);
  });
});
