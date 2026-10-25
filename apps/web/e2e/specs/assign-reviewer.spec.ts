import { expect, PAMPHLET, test, WORKS_ENTRY } from "../support/app";
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
    await dialog.locator("m3e-button", { hasText: "保存" }).click();
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

// 利用者報告 2026-10-25「ユーザーをひらがなで検索できない（iPhone）」。iPhone の日本語キーボードは、ひらがなを「確定」キー（Enter）で
// 確定する。その Enter を候補の決定と取り違えると、打つ前の候補の先頭の人が入ってしまう（漢字は変換候補を押すので Enter が出ない）
test.describe("ユーザーの選択と日本語入力", { tag: "@core" }, () => {
  test("ひらがなで打って「確定」を押しても別の人が入らず、その名前の候補から選べる", async ({
    app,
    page,
  }) => {
    await app.signInAs("mock-nogiku-manager");
    await app.go("/works");
    await page
      .locator(WORKS_ENTRY, { hasText: PAMPHLET })
      .locator(`m3e-button[aria-label^="${PAMPHLET} の校正者を選ぶ"]`)
      .click();
    const dialog = app.dialog();
    const chips = dialog.locator("m3e-input-chip");
    await expect(chips).toHaveCount(0);
    const input = dialog.locator(".picker__input");
    await input.click();
    // 候補が出ている。確定の Enter が候補の決定に取られると、打った文字が消え、そのときの先頭の候補（別の人やグループのこともある）が入る
    await expect(page.getByRole("option").first()).toBeVisible();

    await input.fill("ほんごう");
    await app.imeConfirm(input);
    await expect(input).toHaveValue("ほんごう");
    await expect(chips).toHaveCount(0);

    // ふつうの Enter（PC のキーボード）は、これまでどおり先頭の候補を決める
    await expect(page.getByRole("option", { name: /ほんごう こうせい/ })).toBeVisible();
    await input.press("Enter");
    await expect(chips).toHaveCount(1);
    await expect(chips).toHaveText("ほんごう こうせい");
  });
});
