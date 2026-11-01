import { expect, fixture, PAMPHLET, SLIDE_DECK, test } from "../support/app";

// 旧 screenshots.mjs の 03・04・14・71b・05（最初の版の提出）
test.describe("版の提出", { tag: "@smoke" }, () => {
  test("制作者が複数のファイルで最初の版を出し、写真の確認を校正者に頼める", async ({
    app,
    page,
  }) => {
    const reviewer = await app.user("mock-nogiku-reviewer");
    await app.signInAs("mock-nogiku-creator");
    await app.openWork(PAMPHLET);
    await expect(page.locator(".editor__empty")).toBeVisible();

    const files = [fixture("sample.pdf"), fixture("poster.png"), fixture("greeting.txt")];
    await app.uploadRevision("最初の版を提出", files, "初稿。表紙と地図ページ。", async () => {
      const dialog = app.dialog();
      await page.fill("m3e-dialog[open] textarea >> nth=1", "表紙の配色と団体名の表記");
      // 専門確認: 写真（肖像・権利）を校正者に依頼
      await dialog.locator('m3e-expansion-panel.checks-details [slot="header"]').click();
      await dialog.locator("m3e-checkbox#check-photo").click();
      const photo = dialog.locator(".check").filter({ has: page.locator("#check-photo") });
      await expect(dialog.locator(".check:not(.check--done)")).not.toHaveCount(0);
      await app.pickUser(photo, reviewer.name);
      // 提出前の確認と申告（§58）
      await app.tickSelfChecks();
      await dialog.locator("m3e-checkbox#declare-usesPhotos").click();
      await dialog.locator("m3e-checkbox#declare-usesMascot").click();
    });

    await app.confirmRevision(1);
    await expect(page.locator(".editor__empty")).toHaveCount(0);
  });

  test("ファイルを置くまで、アップロードを始められない", async ({ app, page }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.openWork(PAMPHLET);
    await app.btn("最初の版を提出").click();
    const start = app.dialog().locator("m3e-button", { hasText: "アップロードを開始" });
    await expect(start).toHaveAttribute("disabled");
    await page.setInputFiles('m3e-dialog[open] input[type="file"]', [fixture("sample.pdf")]);
    await expect(start).not.toHaveAttribute("disabled");
  });

  test("小ジャンルスライドは PDF と https リンクが揃うまでアップロードを始められない", async ({
    app,
    page,
  }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.openWork(SLIDE_DECK);
    await app.btn("最初の版を提出").click();
    const dialog = app.dialog();
    const start = dialog.locator("m3e-button", { hasText: "アップロードを開始" });
    await expect(start).toHaveAttribute("disabled");
    await page.setInputFiles('m3e-dialog[open] input[type="file"]', [fixture("sample.pdf")]);
    await expect(start).toHaveAttribute("disabled");
    await dialog.locator('input[type="text"][inputmode="url"]').fill("https://example.com/deck");
    await expect(start).not.toHaveAttribute("disabled");
  });
});
