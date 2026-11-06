import { describe, expect, it } from "vite-plus/test";
import {
  listMyNotifications,
  markNotificationRead,
  markThreadNotificationsRead,
  notify,
} from "../usecases/notifications.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals } from "../testing/scenario.ts";

/** 同じスレッドの通知はまとめて既読になる（利用者指示 2026-11-05） */
describe("スレッド単位の既読", () => {
  const me = principals.creator;
  const post = (ctx: ReturnType<typeof createInMemoryContext>, threadId: string, title: string) =>
    notify(ctx, [me.userId], principals.reviewer.userId, {
      kind: "comment_posted",
      title,
      body: "",
      threadId,
    });

  it("通知を 1 つ既読にすると、同じスレッドの未読も既読になり、別のスレッドは残る", async () => {
    const ctx = createInMemoryContext();
    await post(ctx, "thread-a", "A の 1 件目");
    await post(ctx, "thread-a", "A の 2 件目");
    await post(ctx, "thread-b", "B の 1 件目");
    const [latestA] = (await listMyNotifications(ctx, me)).filter((n) => n.threadId === "thread-a");
    await markNotificationRead(ctx, me, latestA!.id);
    const all = await listMyNotifications(ctx, me);
    expect(all.filter((n) => n.threadId === "thread-a").every((n) => n.readAt !== undefined)).toBe(
      true,
    );
    expect(all.find((n) => n.threadId === "thread-b")?.readAt).toBeUndefined();
  });

  it("スレッドを開いたときは threadId でまとめて既読にできる。既読の分は数えない", async () => {
    const ctx = createInMemoryContext();
    await post(ctx, "thread-a", "A の 1 件目");
    await post(ctx, "thread-a", "A の 2 件目");
    expect(await markThreadNotificationsRead(ctx, me, "thread-a")).toBe(2);
    expect(await markThreadNotificationsRead(ctx, me, "thread-a")).toBe(0);
    expect(await markThreadNotificationsRead(ctx, principals.reviewer, "thread-a")).toBe(0);
  });
});
