import { expect, test, WORKS_ENTRY } from "../support/app";

// 旧 screenshots.mjs の 02・02b・02c（制作物一覧の絞り込みと並べ替え）
test.describe("制作物一覧", { tag: "@smoke" }, () => {
  test.beforeEach(async ({ app }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.go("/works");
    await app.page.locator(WORKS_ENTRY).first().waitFor();
  });

  test("制作担当で絞り込むと、その担当の制作物だけになる（URL にも残る）", async ({
    app,
    page,
  }) => {
    const rows = page.locator(WORKS_ENTRY);
    const site = page.locator(WORKS_ENTRY, { hasText: "公式サイト トップページ" });
    await expect(site).toHaveCount(1);
    const all = await rows.count();

    await page.locator(".works__team--production").click();
    await app.settle();
    await page
      .locator("#works-production-menu m3e-menu-item-radio", { hasText: "広報局 › デザイン担当" })
      .click();

    await expect(page).toHaveURL(/production=/);
    await expect(site).toHaveCount(1);
    await expect.poll(() => rows.count()).toBeLessThan(all);
  });

  test("見出しを押すと昇順、もう一度で降順に並べ替わる", async ({ page }) => {
    const sorted = page.locator(".works .works-table .mf-table__th[aria-sort]");
    // 既定は校正の締切の昇順
    await expect(sorted).toHaveCount(1);
    await expect(sorted).toHaveAttribute("aria-sort", "ascending");

    await page.locator(".works .works-table .mf-table__th .mf-table__sort").nth(3).click();
    await expect(page).toHaveURL(/sort=deadline/);
    await expect(sorted).toHaveCount(1);
    await expect(sorted).toHaveAttribute("aria-sort", "ascending");

    await sorted.locator(".mf-table__sort").click();
    await expect(page).toHaveURL(/dir=desc/);
    await expect(sorted).toHaveAttribute("aria-sort", "descending");
  });

  test("並べ替えのメニューで主管担当順にできる", async ({ app, page }) => {
    await page.locator(".works__sort").click();
    await app.settle();
    await page.locator("#works-sort-menu m3e-menu-item-radio", { hasText: "主管担当順" }).click();
    await expect(page).toHaveURL(/sort=owner/);
  });
});
