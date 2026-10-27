import { expect, test } from "../support/app";
import { reviewerComments, submitFirstRevision } from "../support/scenarios";

// 利用者指示 2026-10-26: 返信も本人が訂正できる。訂正したコメント・返信には「編集済み」の印だけを付け、原文は流れに出さない（§5.2-9 の記録は残す）
test.describe("コメントのスレッドでの訂正", { tag: "@core" }, () => {
  test("校正者が自分の返信と元のコメントを訂正すると、どちらにも印が付き、訂正の記録は流れに並ばない", async ({
    app,
    page,
  }) => {
    const { revisionPath } = await submitFirstRevision(app);
    await reviewerComments(app, revisionPath, "団体名の表記が規約と違います。");
    const card = app.threads().filter({ hasText: "団体名の表記" });
    const panel = await app.openPanel(card);

    await app.replyInPanel(panel, "3 ページ目の見出しです。");
    const reply = panel.locator(".thread__replyitem");
    await expect(panel.locator(".thread__edited")).toHaveCount(0);

    await app.editReply(reply, "3 ページ目の見出しと目次です。");
    await expect(reply.locator(".thread__body")).toContainText("目次");
    await expect(panel.locator(".thread__replyitem .thread__edited")).toHaveCount(1);

    await app.editComment(panel, "団体名の表記が規約と違います（3 ページ）。");
    await expect(panel.locator(".thread-panel__root .thread__body")).toContainText("（3 ページ）");
    await expect(panel.locator(".thread-panel__root .thread__edited")).toHaveCount(1);
    await expect(panel.locator(".thread__event")).toHaveCount(0);
    await expect(panel.locator(".thread__previous")).toHaveCount(0);

    await app.signInAs("mock-nogiku-creator");
    await app.go(revisionPath);
    await app.drawer("コメント");
    const asCreator = await app.openPanel(card);
    await expect(asCreator.locator(".thread__replyitem")).toHaveCount(1);
    await expect(asCreator.locator(".thread__replyitem .thread__edited")).toHaveCount(1);
    await expect(asCreator.locator(".thread-panel__root .thread__edited")).toHaveCount(1);
    await expect(asCreator.locator('m3e-icon-button[aria-label="返信の操作"]')).toHaveCount(0);
    await expect(page.locator(".thread__previous")).toHaveCount(0);
  });
});
