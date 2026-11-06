import { expect, fixture, PAMPHLET, test } from "../support/app";

// MF100 Notion「校正システム」: 校正を出すときに、一部分を開いて閉じると popup ごと閉じてしまう
test.describe("版提出のダイアログの「詳細」", { tag: "@core" }, () => {
  test("「詳細」を開いて畳んでもダイアログは閉じず、書きかけが残る。キャンセルではいつもどおり閉じる", async ({
    app,
    page,
  }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.openWork(PAMPHLET);
    await app.btn("最初の版を提出").click();
    await page.waitForSelector('m3e-dialog[open] input[type="file"]');
    await page.setInputFiles('m3e-dialog[open] input[type="file"]', [fixture("sample.pdf")]);
    await page.fill("m3e-dialog[open] textarea >> nth=0", "初稿。");

    const details = app.dialog().locator("m3e-expansion-panel.checks-details");
    await details.locator('[slot="header"]').click();
    await expect(details).toHaveAttribute("open", "");
    // 畳み終わった合図（closed）は開閉のアニメーションの後に出る。それを待ってからダイアログを見る
    const closed = details.evaluate(
      (el) =>
        new Promise<void>((done) => el.addEventListener("closed", () => done(), { once: true })),
    );
    await details.locator('[slot="header"]').click();
    await closed;
    await page.waitForTimeout(500);

    await expect(page.locator("m3e-dialog[open]")).toHaveCount(1);
    await expect(page.locator("m3e-dialog[open] textarea").first()).toHaveValue("初稿。");

    await app
      .dialog()
      .locator("m3e-button", { hasText: "キャンセル" })
      .filter({ visible: true })
      .click();
    await expect(page.locator("m3e-dialog[open]")).toHaveCount(0);
  });
});
