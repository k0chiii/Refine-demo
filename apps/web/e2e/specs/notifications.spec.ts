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

    // 「未読」に絞っても届いた通知は出る。すべて既読にすると、未読の絞り込みでは空になる
    await page.locator("#notif-menu .notif-filter m3e-button", { hasText: "未読" }).click();
    await expect(page.locator("#notif-menu .notif--unread").first()).toBeVisible();
    await page.locator("#notif-menu m3e-menu-item", { hasText: "すべて既読にする" }).click();
    await page.locator('.bell m3e-icon-button[aria-label^="通知"]').click();
    await expect(page.locator("#notif-menu .notif-menu__empty")).toBeVisible();
    await expect(page.locator("#notif-menu .notif")).toHaveCount(0);
    await page.locator("#notif-menu .notif-filter m3e-button", { hasText: "すべて" }).click();
    await expect(page.locator("#notif-menu .notif").first()).toBeVisible();
  });
});
