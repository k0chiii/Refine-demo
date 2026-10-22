import { expect, test } from "../support/app";
import { reviewerComments, submitFirstRevision } from "../support/scenarios";

// 旧 screenshots.mjs の 09（採否判断）
test.describe("コメントの採否", { tag: "@core" }, () => {
  test("制作者が理由を付けて不採用にすると、スレッドが閉じる", async ({ app, page }) => {
    const { revisionPath } = await submitFirstRevision(app);
    await reviewerComments(app, revisionPath, "団体名の表記が規約と違います。");

    await app.signInAs("mock-nogiku-creator");
    await app.go(revisionPath);
    await app.drawer("コメント");
    const card = app.threads().filter({ hasText: "団体名の表記" });
    const panel = await app.openPanel(card);
    await panel.locator('.thread-panel__bar m3e-icon-button[aria-label="その他の操作"]').click();
    await app.settle();
    await page.locator("m3e-menu-item:visible", { hasText: "不採用" }).click();
    await page.fill(".thread-panel textarea", "正式名称は規約で確認済み");
    await panel.locator("m3e-button", { hasText: "不採用にする" }).click();

    await expect(card.first()).toHaveClass(/thread--closed/);
  });
});
