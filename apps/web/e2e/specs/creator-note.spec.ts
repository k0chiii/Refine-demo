import { expect, test } from "../support/app";
import { submitFirstRevision } from "../support/scenarios";

/**
 * 制作者からのコメント（提出時の「意図」）は、校正のコメントと同じ一覧の先頭に、位置なしのコメントとして留まる
 * （利用者 QA 2026-10-24。それまでは情報タブの「観点」）
 */
test.describe("制作者からのコメント", { tag: "@smoke" }, () => {
  test("提出時の意図がコメントの一覧の先頭に出る", async ({ app, page }) => {
    await submitFirstRevision(app);
    await app.drawer("コメント");
    const note = page.locator(".comments__list [data-creator-note]");
    await expect(note).toHaveCount(1);
    await expect(note).toContainText("初稿。");
    // 一覧の先頭（校正のコメントのカードより前）に留まっている。コメントのカード（.thread）には数えない
    await expect(
      page.locator(".comments__list .creator-note, .comments__list .thread").first(),
    ).toHaveAttribute("data-creator-note", "");
    await expect(page.locator(".comments__list .thread")).toHaveCount(0);
  });
});
