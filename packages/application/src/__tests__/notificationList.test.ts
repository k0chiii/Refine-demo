import { describe, expect, it } from "vite-plus/test";
import { listMyNotifications } from "../usecases/notifications.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { HOUR, principals } from "../testing/scenario.ts";

/** 通知の一覧の「未読」の絞り込み（利用者指示 2026-11-04「過去のものが埋もれる」） */
describe("通知の一覧の未読の絞り込み", () => {
  async function seed(ctx: ReturnType<typeof createInMemoryContext>) {
    const me = principals.creator.userId;
    const base = ctx.clock.now();
    // 古い未読 2 件のあと、既読 3 件（新しい）。既読を含む最新 3 件には古い未読が入らない
    await ctx.notifications.insert({
      recipientId: me,
      kind: "test",
      title: "古い未読 A",
      body: "",
      createdAt: base - 5 * HOUR,
    });
    await ctx.notifications.insert({
      recipientId: me,
      kind: "test",
      title: "古い未読 B",
      body: "",
      createdAt: base - 4 * HOUR,
    });
    for (let i = 3; i >= 1; i--)
      await ctx.notifications.insert({
        recipientId: me,
        kind: "test",
        title: `既読 ${i}`,
        body: "",
        createdAt: base - i * HOUR,
        readAt: base,
      });
    await ctx.notifications.insert({
      recipientId: principals.reviewer.userId,
      kind: "test",
      title: "他人の未読",
      body: "",
      createdAt: base,
    });
  }

  it("既読を含む最新 3 件には古い未読が出ないが、未読だけなら新しい順に出る", async () => {
    const ctx = createInMemoryContext();
    await seed(ctx);
    const all = await listMyNotifications(ctx, principals.creator, 3);
    expect(all.map((n) => n.title)).toEqual(["既読 1", "既読 2", "既読 3"]);
    const unread = await listMyNotifications(ctx, principals.creator, 3, { unreadOnly: true });
    expect(unread.map((n) => n.title)).toEqual(["古い未読 B", "古い未読 A"]);
  });

  it("未読だけでも件数の上限は効く", async () => {
    const ctx = createInMemoryContext();
    await seed(ctx);
    const unread = await listMyNotifications(ctx, principals.creator, 1, { unreadOnly: true });
    expect(unread.map((n) => n.title)).toEqual(["古い未読 B"]);
  });
});
