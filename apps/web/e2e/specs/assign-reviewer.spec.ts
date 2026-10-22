import { expect, test } from "../support/app";
import { submitFirstRevision } from "../support/scenarios";

// 旧 screenshots.mjs の 06・13c・07（校正者の割り当てと、校正者のやること）
test.describe("校正者の割り当て", { tag: "@smoke" }, () => {
  test("主管がグループから校正者だけを割り当てると、校正者の「校正」に未着手で出る", async ({
    app,
    page,
  }) => {
    const { workPath } = await submitFirstRevision(app);
    const reviewer = await app.user("mock-nogiku-reviewer");

    await app.signInAs("mock-nogiku-manager");
    await app.go(workPath);
    await app.pdfReady();
    await app.drawer("情報");
    await app.btn("校正者を割り当てる").click();
    const dialog = app.dialog();
    // グループ「こうせいはん」は校正者と校了者。選ぶと 2 人のチップが並ぶ
    await app.pickUser(dialog, "こうせいはん");
    await expect(dialog.locator("m3e-input-chip")).toHaveCount(2);
    await dialog
      .locator("m3e-input-chip", { hasText: "こうりょう" })
      .locator('[aria-label$="を外す"]')
      .click();
    await expect(dialog.locator("m3e-input-chip")).toHaveCount(1);
    await expect(dialog.locator("m3e-input-chip", { hasText: reviewer.name })).toHaveCount(1);
    await dialog.locator("m3e-button", { hasText: "割り当てる" }).click();
    await expect(dialog).toHaveCount(0);

    await app.signInAs("mock-nogiku-reviewer");
    await app.go("/check");
    const rows = page.locator(".hub[data-hub='check'] .hub-row");
    await expect(rows.filter({ hasText: "MF100 公式パンフレット" }).first()).toBeVisible();
    // 切り替え（未着手・確認中・完了）と、行ごとの次の操作の印
    await expect(page.locator(".hub .hub__tabs m3e-button")).toHaveCount(3);
    await expect(page.locator(".hub .hub-row .hub-chip").first()).toBeVisible();
    // ナビの「校正」が選ばれ、自分の手が要る数がバッジに出る
    const nav = page.locator('m3e-nav-item[data-to="/check"]');
    await expect
      .poll(() => nav.evaluate((el) => (el as HTMLElement & { selected?: boolean }).selected))
      .toBe(true);
    await expect(nav.locator(".badge").first()).toHaveText(/^\s*\d+\s*$/);
  });
});
