import { expect, test } from "../support/app";
import { reviewerComments, submitFirstRevision } from "../support/scenarios";

// 利用者指示 2026-10-27「スレッドを購読　メンションされてなくてもそのスレッドの通知が来るようにしたい」
test.describe("スレッドの購読", { tag: "@core" }, () => {
  test("返信していない制作者は、スレッドを購読した後の返信だけをベルで受け取り、通知からそのスレッドへ行ける", async ({
    app,
    page,
  }) => {
    const { revisionPath } = await submitFirstRevision(app);
    await reviewerComments(app, revisionPath, "凡例の文字の大きさを確認してください。");
    const card = app.threads().filter({ hasText: "凡例の文字" });
    const reviewerReplies = async (body: string) => {
      await app.signInAs("mock-nogiku-reviewer");
      await app.go(revisionPath);
      await app.drawer("コメント");
      await app.replyInPanel(await app.openPanel(card), body);
    };
    const creatorNotifications = async () => {
      await app.signInAs("mock-nogiku-creator");
      const items = await app.openNotifications();
      const count = await items.count();
      await page.keyboard.press("Escape");
      return count;
    };

    const before = await creatorNotifications();
    expect(before).toBeGreaterThan(0);
    await reviewerReplies("3 ページ目の凡例です。");
    expect(await creatorNotifications()).toBe(before);

    await app.go(revisionPath);
    await app.drawer("コメント");
    const panel = await app.openPanel(card);
    const threadId = await panel.getAttribute("data-thread-panel");
    expect(threadId).toBeTruthy();
    const toggle = app.subscribeToggle(panel);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await reviewerReplies("4 ページ目もお願いします。");
    await app.signInAs("mock-nogiku-creator");
    const items = await app.openNotifications();
    await expect(items).toHaveCount(before + 1);
    await items.first().click();
    await page.waitForURL((u) => u.searchParams.get("thread") === threadId);
    const opened = page.locator(`.thread-panel[data-thread-panel="${threadId}"]`);
    await expect(opened).toBeVisible();
    await expect(app.subscribeToggle(opened)).toHaveAttribute("aria-pressed", "true");
  });
});
