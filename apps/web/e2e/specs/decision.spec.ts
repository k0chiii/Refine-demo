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

  test("採否のボタンは選んだカードにだけ出て、反映しないは理由の欄を開いたパネルになる", async ({
    app,
    page,
  }) => {
    const { revisionPath } = await submitFirstRevision(app);
    await app.signInAs("mock-nogiku-reviewer");
    await app.go(revisionPath);
    await app.pdfReady();
    await app.drawer("コメント");
    await app.freeComment("団体名の表記が規約と違います。");
    await app.freeComment("日付の曜日が違います。");

    await app.signInAs("mock-nogiku-creator");
    await app.go(revisionPath);
    await app.drawer("コメント");
    await expect(page.locator(".comments .thread__decide")).toHaveCount(0);
    const card = app.threads().filter({ hasText: "団体名の表記" });
    await card.locator(".thread__body").click();
    await expect(page.locator(".comments .thread__decide")).toHaveCount(1);
    await expect(card.locator(".thread__decide")).toHaveCount(1);
    await card.locator(".thread__decide m3e-button", { hasText: "反映しない" }).click();
    await expect(page.locator(".thread-panel textarea")).toBeFocused();
  });
});
