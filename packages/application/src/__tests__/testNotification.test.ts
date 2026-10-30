import { TEST_NOTIFICATION_INTERVAL_MS } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { planDelivery } from "../usecases/delivery.ts";
import { updateNotificationPrefs } from "../usecases/notificationPrefs.ts";
import { listMyNotifications, notify, sendTestNotification } from "../usecases/notifications.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals } from "../testing/scenario.ts";

const ORIGIN = "https://mf100.example-org.jp";
const me = principals.stranger;

// UI_M3E §112
describe("テスト通知", () => {
  it("押した本人に、制作物も送り主も無い test の通知を 1 件作る", async () => {
    const ctx = createInMemoryContext();
    await sendTestNotification(ctx, me);

    const mine = await listMyNotifications(ctx, me);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ recipientId: me.userId, kind: "test" });
    for (const key of ["workId", "revisionId", "threadId", "actorId"])
      expect(mine[0]).not.toHaveProperty(key);
    expect(await listMyNotifications(ctx, principals.reviewer)).toHaveLength(0);
  });

  it("1 分に 1 回まで。ほかの通知が届いても数えず、1 分たてばまた送れる", async () => {
    const ctx = createInMemoryContext();
    await sendTestNotification(ctx, me);
    await notify(ctx, [me.userId], principals.reviewer.userId, {
      kind: "comment_posted",
      title: "新しいコメント",
      body: "相談です",
    });
    ctx.clock.advance(TEST_NOTIFICATION_INTERVAL_MS - 1);
    await expect(sendTestNotification(ctx, me)).rejects.toMatchObject({
      code: "test_notification_too_soon",
    });
    // 本人ではない人の制限には効かない
    await sendTestNotification(ctx, principals.reviewer);

    ctx.clock.advance(1);
    await sendTestNotification(ctx, me);
    const tests = (await listMyNotifications(ctx, me)).filter((n) => n.kind === "test");
    expect(tests).toHaveLength(2);
  });

  it("分類をすべて止めていても、オンにした経路へ届ける計画になる", async () => {
    const ctx = createInMemoryContext();
    ctx.state.emails.set(me.userId, "stranger@example-org.jp");
    await updateNotificationPrefs(ctx, me, {
      channels: ["email"],
      mutedCategories: ["mention", "reply", "assignment", "deadline", "rule", "other"],
    });
    await sendTestNotification(ctx, me);
    const [n] = await listMyNotifications(ctx, me);

    const plan = await planDelivery(ctx, n!.id, { available: new Set(["email"]), origin: ORIGIN });
    expect(plan?.targets.map((t) => t.channel)).toEqual(["email"]);
    const [target] = plan!.targets;
    if (target?.channel !== "email") throw new Error("email target expected");
    expect(target.content.text.split("\n")).toContain(`${ORIGIN}/`);
  });
});
