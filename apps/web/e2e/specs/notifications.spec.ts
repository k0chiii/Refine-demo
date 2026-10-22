import { expect, test } from "../support/app";
import { reviewerComments, submitFirstRevision } from "../support/scenarios";

// 旧 screenshots.mjs の 18・32（通知のベル）
test.describe("通知", { tag: "@core" }, () => {
  test("校正者がコメントすると、制作者のベルに通知が届く", async ({ app, page }) => {
    const { revisionPath } = await submitFirstRevision(app);
    await reviewerComments(app, revisionPath, "凡例の文字の大きさを確認してください。");

    await app.signInAs("mock-nogiku-creator");
    await page.locator('.bell m3e-icon-button[aria-label^="通知"]').click();
    await expect(page.locator("#notif-menu .notif").first()).toBeVisible();
    await expect(page.locator("#notif-menu")).toContainText("MF100 公式パンフレット");
  });
});
