import { expect, test, WORKS_ENTRY } from "../support/app";

test.describe("校正者名簿と閲覧権限", { tag: "@smoke" }, () => {
  test("登録でグループを校正者にし、管理者が同じグループに閲覧を付ける", async ({ app, page }) => {
    const creator = await app.user("mock-nogiku-creator");
    const approver = await app.user("mock-nogiku-approver");
    const title = "名簿確認の制作物";

    await app.signInAs("mock-nogiku-creator");
    await app.go("/works");
    await page.locator('.shell__appbar m3e-icon-button[aria-label="制作物を登録"]').click();
    const dialog = app.dialog();
    await dialog.locator("input").first().fill(title);
    await dialog.locator("m3e-select").first().click();
    await page.getByRole("option", { name: "グラフィック", exact: true }).click();
    await app.pickUser(dialog.locator("m3e-form-field", { hasText: "制作者" }), creator.name);
    await app.pickUser(
      dialog.locator("m3e-form-field", { hasText: "校了者（校了権限者）" }),
      approver.name,
    );
    await app.pickUser(dialog.locator("m3e-form-field", { hasText: "校正者" }), "こうせいはん");
    await expect(dialog.locator("m3e-input-chip")).toHaveCount(4);
    await dialog.locator("m3e-button", { hasText: "登録" }).click();
    await page.waitForURL(/\/works\/[^/]+$/);

    await app.go("/works");
    const row = page.locator(WORKS_ENTRY, { hasText: title }).first();
    await expect(row.getByRole("button", { name: /の校正者を選ぶ（いま: / })).toBeVisible();

    await app.signInAs("mock-nogiku-admin");
    await app.go("/admin");
    await page
      .locator('m3e-action-list[aria-label="制作物ごとの閲覧権限"] m3e-list-action', {
        hasText: title,
      })
      .click();
    const acl = app.dialog();
    await app.pickUser(acl, "こうせいはん");
    await expect(acl.locator("m3e-input-chip")).toHaveCount(2);
    await acl.locator("m3e-button", { hasText: "追加" }).click();
    await expect(acl.locator('m3e-list[aria-label="個人の許可"] m3e-list-item')).toHaveCount(2);
  });
});
