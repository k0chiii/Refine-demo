import type { Locator } from "@playwright/test";
import { expect, test } from "../support/app";

/**
 * 制作物の編集の「日程と入稿」（利用者指示 2026-10-30「これ、トグルでチェック入れた時だけ開くようにしたい」。UI_M3E §108）。
 * - 部数・サイズ・尺・制作日数の欄は、入稿のスイッチを入れたときだけ出る
 * - 入れて書いた部数は保存すると残る。切って保存すると、開き直しても切れたまま
 * - 切って隠した欄の値は消えない（もう一度入れると、書いた部数がそのまま出る）
 */
test.describe("制作物の入稿の欄", () => {
  const title = "公式 Instagram 開催告知";

  test("入稿のスイッチを入れたときだけ欄が出て、保存した値は切っても残る", async ({ app }) => {
    await app.signInAs("mock-nogiku-manager");
    await app.go("/works");

    const open = async () => {
      const dialog = await app.editWorkFromList(title);
      return {
        dialog,
        toggle: dialog.locator('[data-field="requiresPrinterSubmission"] m3e-switch'),
        fields: dialog.locator('[data-fields="submission"]'),
      };
    };
    const save = async (dialog: Locator) => {
      await dialog.locator("m3e-button", { hasText: "保存" }).click();
      await expect(dialog).toHaveCount(0);
    };

    let form = await open();
    await expect(form.toggle).toHaveJSProperty("checked", false);
    await expect(form.fields).toHaveCount(0);
    await form.toggle.click();
    await expect(form.fields).toBeVisible();
    await expect(form.fields.locator("input")).toHaveCount(3);
    await form.fields.locator("input").first().fill("500");
    await save(form.dialog);

    form = await open();
    await expect(form.toggle).toHaveJSProperty("checked", true);
    await expect(form.fields.locator("input").first()).toHaveValue("500");
    await form.toggle.click();
    await expect(form.fields).toHaveCount(0);
    await save(form.dialog);

    form = await open();
    await expect(form.toggle).toHaveJSProperty("checked", false);
    await expect(form.fields).toHaveCount(0);
    await form.toggle.click();
    await expect(form.fields.locator("input").first()).toHaveValue("500");
  });
});
