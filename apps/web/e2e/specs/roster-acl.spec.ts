import { expect, test, WORKS_ENTRY } from "../support/app";

test.describe("校正者名簿と閲覧権限", { tag: "@smoke" }, () => {
  test("登録でグループを校正者にし、管理者が同じグループに閲覧を付ける", async ({ app, page }) => {
    const creator = await app.user("mock-nogiku-creator");
    const title = "名簿確認の制作物";

    await app.signInAs("mock-nogiku-creator");
    await app.go("/works");
    await page.locator('.shell__appbar m3e-icon-button[aria-label="制作物を登録"]').click();
    const dialog = app.dialog();
    await dialog.locator("input").first().fill(title);
    await dialog.locator("m3e-select").first().click();
    await page.getByRole("option", { name: "印刷物（紙・ビラ）", exact: true }).click();
    await app.pickUser(dialog.locator("m3e-form-field", { hasText: "制作者" }), creator.name);
    await app.fillOutlinedDate(dialog, "■仕上がり日", "2026-12-01");
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

    await app.signInAs("mock-nogiku-manager");
    await app.go("/works");
    const rowAfter = page.locator(WORKS_ENTRY, { hasText: title }).first();
    await rowAfter.getByRole("button", { name: /の校正者を選ぶ/ }).click();
    const reviewers = app.dialog();
    await app.pickUser(reviewers, "こうせいはん");
    await reviewers.locator("m3e-button", { hasText: "保存" }).click();
  });

  // システム管理者はすべての操作権限を持つ（利用者決定 2026-10-30・UI_M3E §113）。シードの管理者は職責・ACL・所属を持たない
  test("管理者は職責・ACL の無い非公開の制作物も一覧に出て、情報を編集できる", async ({
    app,
    page,
  }) => {
    const title = "公式 Instagram 開催告知";
    const purpose = "管理者が書き足した区分。";
    await app.restrictWork(title);

    await app.signInAs("mock-nogiku-admin");
    await app.go("/works");
    const dialog = await app.editWorkFromList(title);
    await dialog.locator("m3e-expansion-panel").click();
    await dialog.locator("m3e-form-field", { hasText: "区分" }).locator("input").fill(purpose);
    await dialog.locator("m3e-button", { hasText: "保存" }).click();
    await expect(dialog).toHaveCount(0);
    await app.openWork(title);
    await app.drawer("情報");
    await expect(page.locator(".drawer__body")).toContainText(purpose);
  });
});
