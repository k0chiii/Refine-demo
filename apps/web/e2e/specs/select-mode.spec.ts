import { expect, test } from "../support/app";
import { submitFirstTextRevision } from "../support/scenarios";

// §106 スマホの文字選択に「文字」と「コメント」の切り替え。コメントのあいだは選ぶことがコメント
test.describe("スマホの文字選択の切り替え", { tag: "@core" }, () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("既定は選ぶと投稿欄が開き、文字にすると選んでも開かず、読み直しても文字のまま", async ({
    app,
    page,
  }) => {
    await submitFirstTextRevision(app);
    const toggle = app.selectModeToggle();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await app.selectText("五月祭常任委員会");
    const composer = app.composer("docked");
    await expect(composer).toBeVisible();
    await expect.poll(() => page.evaluate(() => String(getSelection()))).toBe("");
    // 画面下の欄は下のツールバーに重なるので、何も書かずに閉じてから切り替える（空の欄は Esc で取消）
    await composer.locator(".rt__content").click();
    await page.keyboard.press("Escape");
    await expect(app.composer()).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await app.ready();
    await page.evaluate(() => globalThis.__mf100demo!.ensureSeeded());
    await submitFirstTextRevision(app);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // 選択が落ち着くまでの待ちを、固定の待ちではなく時計を進めて越える
    await page.clock.install();
    await app.selectText("本祭を企画");
    await page.clock.runFor(1000);
    await expect(app.composer()).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.clock.runFor(1000);
    await expect(composer).toBeVisible();
  });
});
