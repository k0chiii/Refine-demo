import { expect, test } from "../support/app";

// MF100 Notion「校正システム」: 日付の登録で、入力日にちが 1 桁になり編集できない（日本語入力のまま数字を打ったとき）
test.describe("日付の欄の日本語入力", { tag: "@core" }, () => {
  test("日本語入力のまま「１５」と打っても日が 15 になり、保存して開き直しても残る", async ({
    app,
  }) => {
    const title = "公式 Instagram 開催告知";
    await app.signInAs("mock-nogiku-manager");
    await app.go("/works");
    let dialog = await app.editWorkFromList(title);
    const day = () =>
      dialog.getByRole("group", { name: /校了目標日/ }).getByRole("spinbutton", { name: "日" });

    await day().click();
    await app.imeType("１５");
    await expect(day()).toHaveText("15");
    // 確定したあとも半角で打ち直せる
    await day().click();
    await app.page.keyboard.type("1");
    await app.page.keyboard.type("6");
    await expect(day()).toHaveText("16");
    await day().click();
    await app.imeType("１５");
    await app.page.keyboard.press("Tab");
    await expect(day()).toHaveText("15");

    await dialog.locator("m3e-button", { hasText: "保存" }).click();
    await expect(dialog).toHaveCount(0);
    dialog = await app.editWorkFromList(title);
    await expect(day()).toHaveText("15");
  });
});
