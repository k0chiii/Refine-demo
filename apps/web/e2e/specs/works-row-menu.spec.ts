import { expect, test, WORKS_ENTRY } from "../support/app";

/**
 * 制作物一覧の行の「⋮」（利用者 QA 2026-10-24: 情報の変更とコピーを一覧から）。
 * - 主管は「情報を編集」で目的・用途をあとから書ける（保存すると制作物の情報に残る）
 * - 登録できる人は「複製」で、同じ情報の新しい制作物を登録できる（題名は「（コピー）」付きで始まり、行が 1 つ増える）
 * - 主管でない人（制作者）の行には「情報を編集」が出ない
 */
test.describe("制作物一覧の行メニュー", { tag: "@smoke" }, () => {
  const title = "公式 Instagram 開催告知";

  test("主管が ⋮ → 情報を編集で目的・用途を書き足せる", async ({ app, page }) => {
    await app.signInAs("mock-nogiku-manager");
    await app.go("/works");
    const dialog = await app.editWorkFromList(title);
    await expect(dialog.locator(':scope > [slot="header"]')).toHaveText("制作物を編集");
    await dialog.locator("m3e-expansion-panel").click();
    const category = dialog.locator("m3e-form-field", { hasText: "区分" }).locator("input");
    await category.fill("開催告知（一覧から更新）");
    await dialog.locator("m3e-button", { hasText: "保存" }).click();
    await expect(dialog).toHaveCount(0);
    // 一覧に戻ったまま（エディタへは移らない）。書いた区分は制作物の情報に残る
    await expect(page).toHaveURL(/\/works(\?|$)/);
    await app.openWork(title);
    await app.drawer("情報");
    await expect(page.locator(".drawer__body")).toContainText("開催告知（一覧から更新）");
  });

  test("⋮ → 複製で同じ情報の制作物がもう 1 件できる", async ({ app, page }) => {
    await app.signInAs("mock-nogiku-manager");
    await app.go("/works");
    const rows = page.locator(WORKS_ENTRY);
    await rows.first().waitFor();
    const before = await rows.count();
    const row = rows.filter({ hasText: title }).first();
    await app.openMenu(row.locator(`m3e-icon-button[aria-label="${title} の操作"]`));
    await row.locator("m3e-menu m3e-menu-item", { hasText: "複製" }).click();
    const dialog = app.dialog();
    await expect(dialog.locator(':scope > [slot="header"]')).toHaveText("制作物を複製");
    // 題名は「（コピー）」付きで入っている。元の情報（制作者・校了者）も入っているので、そのまま登録できる
    await expect(dialog.locator("input").first()).toHaveValue(`${title}（コピー）`);
    await dialog.locator("m3e-button", { hasText: "複製して登録" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/works(\?|$)/);
    await expect(rows).toHaveCount(before + 1);
    await expect(rows.filter({ hasText: `${title}（コピー）` })).toHaveCount(1);
  });

  test("制作者の行には「情報を編集」が無く、複製だけ出る", async ({ app, page }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.go("/works");
    const row = page.locator(WORKS_ENTRY, { hasText: title }).first();
    await app.openMenu(row.locator(`m3e-icon-button[aria-label="${title} の操作"]`));
    const menu = row.locator("m3e-menu");
    await expect(menu.locator("m3e-menu-item", { hasText: "複製" })).toBeVisible();
    await expect(menu.locator("m3e-menu-item", { hasText: "情報を編集" })).toHaveCount(0);
  });
});
