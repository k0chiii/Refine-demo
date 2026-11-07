import { expect, PAMPHLET, test } from "../support/app";

// MF100 Notion「校正システム」: 行頭の「# 」で勝手に見出しになり、Cmd+Z で標準テキストに戻らない
test.describe("文章の自動の書式の取り消し", { tag: "@core" }, () => {
  test("文末で「# 」と打って見出しになったあと、Cmd+Z で見出しだけが解け、打った文字は残る", async ({
    app,
    page,
  }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.openWork(PAMPHLET);
    await app.btn("文章を書く").click();
    const body = page.getByRole("textbox", { name: "本文" });
    await body.click();
    await page.keyboard.type("本文");
    await page.keyboard.press("Enter");
    await page.keyboard.type("# ");
    await expect(body.locator("h1")).toHaveCount(1);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(body.locator("h1")).toHaveCount(0);
    await expect(body.locator("p").nth(1)).toHaveText("# ");
    await expect(body.locator("p").first()).toHaveText("本文");
  });
});
