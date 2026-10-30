import { expect, test } from "../support/app";
import { reviewerComments, submitFirstRevision } from "../support/scenarios";

// 旧 screenshots.mjs の 09（採否判断）
test.describe("コメントの反映するかどうか", { tag: "@smoke" }, () => {
  test("制作者が理由を付けて反映しないにすると、スレッドが閉じる", async ({ app, page }) => {
    const { revisionPath } = await submitFirstRevision(app);
    await reviewerComments(app, revisionPath, "団体名の表記が規約と違います。");

    await app.signInAs("mock-nogiku-creator");
    await app.go(revisionPath);
    await app.drawer("コメント");
    const card = app.threads().filter({ hasText: "団体名の表記" });
    const panel = await app.openPanel(card);
    await panel.locator(".thread__decide m3e-button", { hasText: "反映しない" }).click();
    await page.fill(".thread-panel textarea", "正式名称は規約で確認済み");
    await panel.locator(".thread__form m3e-button", { hasText: "反映しない" }).click();

    await expect(card.first()).toHaveClass(/thread--closed/);
  });
});
