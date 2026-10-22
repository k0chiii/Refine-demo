import { expect, test } from "../support/app";
import { reviewerComments, submitFirstRevision } from "../support/scenarios";

// 旧 screenshots.mjs の 10・11（校了）。未解決のコメントが残るときは理由が要る（docs/REQUIREMENTS.md）
test.describe("校了", { tag: "@core" }, () => {
  test("校了者が校了を確定すると、制作者の「制作」の校了済みに出る", async ({ app, page }) => {
    const { workPath } = await submitFirstRevision(app);

    await app.signInAs("mock-nogiku-approver");
    await app.go(workPath);
    await app.pdfReady();
    await app.drawer("情報");
    await app.btn("校了を宣言").click();
    await app.dialog().locator("m3e-button", { hasText: "校了を確定する" }).click();
    await expect(app.dialog()).toHaveCount(0, { timeout: 15_000 });
    await expect(app.btn("校了を宣言")).toHaveCount(0);

    await app.signInAs("mock-nogiku-creator");
    await app.go("/make");
    await page.getByRole("radio", { name: "校了済み" }).click();
    await expect(page.getByRole("button", { name: /MF100 公式パンフレット/ })).toBeVisible();
  });

  test("未解決のコメントが残っていると、校了のダイアログが件数を示して理由を求める", async ({
    app,
  }) => {
    const { workPath, revisionPath } = await submitFirstRevision(app);
    await reviewerComments(app, revisionPath, "表紙の団体名を確認してください。");

    await app.signInAs("mock-nogiku-approver");
    await app.go(workPath);
    await app.pdfReady();
    await app.drawer("情報");
    await app.btn("校了を宣言").click();
    await expect(app.dialog()).toContainText("未対応のコメントが 1 件あります");
    await expect(app.dialog().getByLabel("例外校了の理由")).toBeVisible();
  });
});
