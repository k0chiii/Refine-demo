import { expect, test, type App } from "../support/app";
import { reviewerComments, submitFirstRevision } from "../support/scenarios";

// 旧 screenshots.mjs の 10・11（校了）。未解決のコメントが残るときは理由が要る（docs/REQUIREMENTS.md）
/**
 * 校了したことは、制作者の「制作」→「校了済み」に出ることで確かめる。
 * 「校了を宣言」が消えるのは自分が宣言しただけでも起きる（校了者が複数なら人数に届くまで校了にならない）ので、それでは足りない
 */
async function expectFinalizedForCreator(app: App) {
  await app.signInAs("mock-nogiku-creator");
  await app.go("/make");
  await app.page.getByRole("radio", { name: "校了済み" }).click();
  await expect(app.page.getByRole("button", { name: /MF100 公式パンフレット/ })).toBeVisible();
}

test.describe("校了", { tag: "@core" }, () => {
  test("校了者が校了を確定すると、制作者の「制作」の校了済みに出る", async ({ app }) => {
    const { workPath } = await submitFirstRevision(app);

    await app.signInAs("mock-nogiku-approver");
    await app.go(workPath);
    await app.pdfReady();
    await app.drawer("情報");
    await app.btn("校了を宣言").click();
    await app.dialog().locator("m3e-button", { hasText: "校了を確定する" }).click();
    await expect(app.dialog()).toHaveCount(0, { timeout: 15_000 });
    await expectFinalizedForCreator(app);
  });

  test("未解決のコメントが残っていると理由なしでは校了できず、例外校了の理由を書けば校了できる", async ({
    app,
  }) => {
    const { workPath, revisionPath } = await submitFirstRevision(app);
    await reviewerComments(app, revisionPath, "表紙の団体名を確認してください。");

    await app.signInAs("mock-nogiku-approver");
    await app.go(workPath);
    await app.pdfReady();
    await app.drawer("情報");
    await app.btn("校了を宣言").click();
    const dialog = app.dialog();
    const confirm = dialog.locator("m3e-button", { hasText: "校了を確定する" });
    await expect(dialog.locator(".alert--warn")).not.toHaveCount(0);

    // 理由なし: 校了されない（ダイアログが残り、宣言の操作も残る）
    await confirm.click();
    await expect(dialog).toBeVisible();
    await app.settle();
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("例外校了の理由").fill("団体名は規約で確認済み。次年度の版で直す");
    await confirm.click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await expectFinalizedForCreator(app);
  });
});
