import { expect, test } from "../support/app";
import { reviewerComments, submitFirstRevision } from "../support/scenarios";

// 利用者指示 2026-11-06（MF100 Notion「コメント付き校了」）: 校了者もコメントを閉じられるようにする（解決のみ）
test.describe("校了者のコメントの解決", { tag: "@core" }, () => {
  test("校了者は残ったコメントを「解決」で閉じ、理由なしで校了できる。反映しない・次の版で対応は出ない", async ({
    app,
    page,
  }) => {
    const { workPath, revisionPath } = await submitFirstRevision(app);
    await reviewerComments(app, revisionPath, "表紙の団体名を確認してください。");

    await app.signInAs("mock-nogiku-approver");
    await app.go(revisionPath);
    await app.pdfReady();
    await app.drawer("コメント");
    const card = app.threads().filter({ hasText: "表紙の団体名" });
    await card.locator(".thread__body").first().click();
    await expect(card.locator("m3e-button", { hasText: "反映しない" })).toHaveCount(0);
    await expect(card.locator("m3e-button", { hasText: "次の版で対応" })).toHaveCount(0);
    await card.locator("m3e-button", { hasText: "解決" }).click();
    await expect(card).toHaveClass(/thread--closed/);

    await app.go(workPath);
    await app.pdfReady();
    await app.drawer("情報");
    await app.btn("校了を宣言").click();
    await app.dialog().locator("m3e-button", { hasText: "校了を確定する" }).click();
    await expect(app.dialog()).toHaveCount(0, { timeout: 15_000 });
    await app.signInAs("mock-nogiku-creator");
    await app.go("/make");
    await page.getByRole("radio", { name: "校了済み" }).click();
    await expect(page.getByRole("button", { name: /MF100 公式パンフレット/ })).toBeVisible();
  });
});
