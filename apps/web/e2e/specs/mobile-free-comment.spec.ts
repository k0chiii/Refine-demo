import { expect, test } from "../support/app";
import { submitFirstTextRevision } from "../support/scenarios";

// スマホは引き出しが紙面のツールバーを隠すので、位置なしのコメントと印の表示はコメントの一覧で扱う。ツールバーは幅に収まる
test.describe("スマホの全体へのコメント", { tag: "@core" }, () => {
  test.use({ viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true });

  test("ツールバーが幅に収まり、コメントの一覧から全体へのコメントを足せる", async ({
    app,
    page,
  }) => {
    await submitFirstTextRevision(app);
    const toolbar = page.locator("m3e-toolbar.ws__toolbar");
    await expect(toolbar.getByRole("button", { name: "情報" })).toBeVisible();
    const fits = await toolbar.evaluate((t) => {
      const items = t.querySelector(".ws__toolbar-items")!;
      return (
        items.scrollWidth <= items.clientWidth && t.getBoundingClientRect().right <= innerWidth
      );
    });
    expect(fits).toBe(true);

    await toolbar.getByRole("button", { name: /^コメント（/ }).click();
    await page.getByRole("button", { name: "全体へのコメント" }).click();
    await app.send("全体の書体をそろえてください。");
    await expect(app.threads().filter({ hasText: "全体の書体をそろえてください。" })).toHaveCount(
      1,
    );

    // 印の表示の切り替えも一覧の中。隠しても一覧のカードは残る
    await expect(toolbar.getByRole("button", { name: "コメントを隠す" })).toHaveCount(0);
    await page.getByRole("button", { name: "コメントを隠す" }).click();
    await expect(page.getByRole("button", { name: "コメントを表示する" })).toHaveAttribute(
      "selected",
    );
    await expect(app.threads()).toHaveCount(1);
  });
});
