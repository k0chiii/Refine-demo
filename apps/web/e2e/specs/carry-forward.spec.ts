import { expect, test } from "../support/app";
import { reviewerComments, submitFirstRevision, submitNextRevision } from "../support/scenarios";

// 旧 screenshots.mjs の 17（第2版の提出と、前版の未解決コメントの持ち越し）
test.describe("次の版への持ち越し", { tag: "@core" }, () => {
  test("第2版を出すと前版の未解決コメントが候補に出て、持ち越すと第2版のコメントになる", async ({
    app,
    page,
  }) => {
    const { revisionPath } = await submitFirstRevision(app);
    await reviewerComments(app, revisionPath, "凡例の文字が小さく、印刷時に読めません。");

    await app.signInAs("mock-nogiku-creator");
    await app.go(revisionPath);
    await app.pdfReady();
    await submitNextRevision(app, 2, "凡例の文字サイズを調整。");
    await app.drawer("コメント");

    const carry = page.locator('[aria-label="前版の未解決コメント"]');
    await expect(carry).toContainText("凡例の文字が小さく");
    const before = await app.threads().count();
    await carry.locator("m3e-button", { hasText: "この版へ持ち越す" }).first().click();
    await expect(app.threads()).toHaveCount(before + 1);
    await expect(app.threads().filter({ hasText: "凡例の文字が小さく" })).toHaveCount(1);
  });
});
