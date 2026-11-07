import { expect, PAMPHLET, test } from "../support/app";

// 文章エディタの「原文（Markdown）／プレビュー」の切り替え。書式は Markdown で表せるものだけにする
test.describe("文章の原文（Markdown）とプレビュー", { tag: "@core" }, () => {
  test("見出しを打ち、原文に切り替えて足し、プレビューに戻すと反映されている", async ({
    app,
    page,
  }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.openWork(PAMPHLET);
    await app.btn("文章を書く").click();
    const body = page.getByRole("textbox", { name: "本文" });
    await body.click();
    await page.keyboard.type("# ");
    await page.keyboard.type("見出し");
    await expect(body.locator("h1")).toHaveCount(1);

    await app.writeMode("原文").click();
    const source = app.writeSource();
    await expect(source).toBeVisible();
    await expect(source).toHaveValue(/^# 見出し/);

    await source.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\n\n**太字**です");
    await app.writeMode("プレビュー").click();

    await expect(source).toHaveCount(0);
    await expect(body.locator("h1")).toHaveText("見出し");
    await expect(body.locator("strong")).toHaveText("太字");
  });

  test("原文のあいだは書式のボタンが押せない", async ({ app, page }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.openWork(PAMPHLET);
    await app.btn("文章を書く").click();
    await expect(page.locator("#wt-bold")).toBeEnabled();
    await app.writeMode("原文").click();
    await expect(page.locator("#wt-bold")).toBeDisabled();
    await expect(page.locator("#wt-style")).toBeDisabled();
    await app.writeMode("プレビュー").click();
    await expect(page.locator("#wt-bold")).toBeEnabled();
  });

  test("文字の色・ハイライトの色・揃えのボタンはツールバーに無い", async ({ app, page }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.openWork(PAMPHLET);
    await app.btn("文章を書く").click();
    await expect(page.locator("#wt-bold")).toBeVisible();
    await expect(
      page.locator(
        '[aria-label^="文字の色"], [aria-label^="ハイライトの色"], [aria-label^="配置"], [aria-label^="中央揃え"]',
      ),
    ).toHaveCount(0);
  });
});
