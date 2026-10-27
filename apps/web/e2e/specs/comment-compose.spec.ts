import { expect, PAMPHLET, test } from "../support/app";
import { assignReviewer, submitFirstRevision } from "../support/scenarios";

// 840px 以上の新しいコメントの投稿欄は、紙面に浮かべず引き出し「コメント」の一番下（利用者指示 2026-10-26。docs/UI_M3E.md §101）
test.describe("引き出しの投稿欄", { tag: "@core" }, () => {
  test("広い画面で紙面をなぞると、引き出しがコメントに替わり、その下の欄から投稿できる", async ({
    app,
    page,
  }) => {
    const { workPath } = await submitFirstRevision(app);
    await assignReviewer(app, workPath);

    await app.signInAs("mock-nogiku-reviewer");
    await app.go("/check");
    await page.locator("m3e-list-action", { hasText: PAMPHLET }).first().click();
    await page.waitForURL(/\/works\//);
    await app.pdfReady();
    await app.drawer("版");
    await expect(page.locator(".comments")).toHaveCount(0);

    await app.drawRect(0.15, 0.12, 0.6, 0.22);
    await expect(app.composer("drawer").locator(".rt__content")).toBeVisible();
    await expect(app.composer("viewer")).toHaveCount(0);
    await expect(page.locator(".viewer__overlay .anchor-draft")).toHaveCount(1);

    await app.send("団体名の表記が規約と違います。");
    await expect(app.threads()).toHaveCount(1);
    await expect(page.locator(".viewer__overlay [data-anchor]")).toHaveCount(1);
    await expect(page.locator(".viewer__overlay .anchor-draft")).toHaveCount(0);

    await app.freeComment("凡例の文字が小さく、印刷時に読めない可能性があります。");
    await expect(app.threads()).toHaveCount(2);
    await expect(app.threads().filter({ hasText: "凡例の文字が小さく" })).toHaveCount(1);
    await expect(page.locator(".viewer__overlay [data-anchor]")).toHaveCount(1);

    await app.openPanel(app.threads().first());
    await app.drawRect(0.2, 0.5, 0.7, 0.6);
    await app.composer("drawer").locator(".rt__content").click();
    await expect(page.locator(".thread-panel")).toHaveCount(1);
    await app.send("写真の説明の位置を確認してください。");
    await expect(page.locator(".viewer__overlay [data-anchor]")).toHaveCount(2);
    await expect(page.locator(".thread-panel")).toHaveCount(1);
  });
});
