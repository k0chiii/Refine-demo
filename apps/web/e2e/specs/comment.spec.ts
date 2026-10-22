import { expect, test } from "../support/app";
import { assignReviewer, submitFirstRevision } from "../support/scenarios";

// 旧 screenshots.mjs の 08（紙面にコメント）
test.describe("紙面へのコメント", { tag: "@smoke" }, () => {
  test("校正者が「校正」の行から開き、なぞってコメント・位置なしのコメントを付けられる", async ({
    app,
    page,
  }) => {
    const { workPath } = await submitFirstRevision(app);
    await assignReviewer(app, workPath);

    await app.signInAs("mock-nogiku-reviewer");
    await app.go("/check");
    await page.locator("m3e-list-action", { hasText: "MF100 公式パンフレット" }).first().click();
    await page.waitForURL(/\/works\//);
    await app.pdfReady();
    await app.drawer("コメント");

    await app.commentOnRect(0.15, 0.12, 0.6, 0.22, "団体名の表記が規約と違います。");
    await expect(app.threads()).toHaveCount(1);
    // なぞったコメントは紙面に印が出る
    await expect(page.locator(".viewer__overlay [data-anchor]")).not.toHaveCount(0);

    await app.freeComment("凡例の文字が小さく、印刷時に読めない可能性があります。");
    await expect(app.threads()).toHaveCount(2);
    await expect(app.threads().filter({ hasText: "凡例の文字が小さく" })).toHaveCount(1);
  });
});
