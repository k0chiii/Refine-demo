import { expect, test } from "../support/app";
import { submitFirstTextRevision } from "../support/scenarios";

// §106 スマホの文字選択に「文字」と「コメント」の切り替え
test.describe("スマホの文字選択の切り替え", { tag: "@core" }, () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("既定はコメントで、文字にすると選んでも FAB が出ず、読み直しても文字のまま", async ({
    app,
    page,
  }) => {
    await submitFirstTextRevision(app);
    const toggle = app.selectModeToggle();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await app.selectText("五月祭常任委員会");
    await expect(app.touchComment()).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(app.touchComment()).toHaveCount(0);

    await page.reload();
    await app.ready();
    await page.evaluate(() => globalThis.__mf100demo!.ensureSeeded());
    await submitFirstTextRevision(app);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // 選択が落ち着くまでの待ちを、固定の待ちではなく時計を進めて越える
    await page.clock.install();
    await app.selectText("本祭を企画");
    await page.clock.runFor(1000);
    await expect(app.touchComment()).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.clock.runFor(1000);
    await expect(app.touchComment()).toBeVisible();
  });
});
