import { expect, fixture, test } from "../support/app";

// MF100 Notion「校正システム」: SNS の校正で、画像を 1 枚ずつ表示したあとも Instagram の表示へ戻せるように
test.describe("SNS 投稿の版の表示の切り替え", { tag: "@core" }, () => {
  test("画像を 1 枚だけ表示したあと、「投稿のプレビュー」で投稿の表示へ戻れる", async ({
    app,
    page,
  }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.openWork("公式 Instagram 開催告知");
    await app.btn("最初の版を提出").click();
    await page.waitForSelector(".post-edit");
    await page.locator(".choice-group m3e-button", { hasText: "カルーセル" }).click();
    await page.locator(".post-edit textarea").first().fill("五月祭を開催します！ #五月祭");
    await page.setInputFiles('.post-edit input[type="file"]', [
      fixture("poster.png"),
      fixture("notation-sample.png"),
    ]);
    await page.waitForSelector(".post-image__thumb");
    await app.btn("版として提出").click();
    await app.dialog().locator("m3e-button", { hasText: "アップロードを開始" }).click();
    await expect(page.locator(".upload-item__state--verified")).not.toHaveCount(0, {
      timeout: 30_000,
    });
    await app.dialog().locator("m3e-button", { hasText: "提出する" }).click();
    await page.waitForURL(/\/v\/1$/);
    await expect(page.locator(".post-review .sp-figure").first()).toBeVisible({ timeout: 20_000 });

    const menu = page.locator('m3e-icon-button[aria-label="コメントの表示"]');
    await menu.click();
    await page.locator("m3e-menu-item-radio", { hasText: "poster.png" }).click();
    await expect(page.locator(".post-review")).toHaveCount(0);

    await menu.click();
    await page.locator("m3e-menu-item-radio", { hasText: "投稿のプレビュー" }).click();
    await expect(page.locator(".post-review .sp-figure").first()).toBeVisible();
  });
});
