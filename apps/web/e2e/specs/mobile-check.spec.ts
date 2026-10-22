import { expect, LONG_TITLE, test } from "../support/app";
import { assignReviewer, submitFirstRevision } from "../support/scenarios";

// 旧 screenshots.mjs の 20c・20e（スマホの「校正」が横にはみ出さない）
test.describe("スマホの校正", { tag: "@core" }, () => {
  for (const [width, height] of [
    [412, 915],
    [360, 780],
  ] as const) {
    test(`${width}px でも長い題名の行が右端で切れず、ページが横にはみ出さない`, async ({
      app,
      page,
    }) => {
      const { workPath } = await submitFirstRevision(app, LONG_TITLE);
      await assignReviewer(app, workPath);
      await app.signInAs("mock-nogiku-reviewer");
      await page.setViewportSize({ width, height });
      await app.go("/check");
      await page.locator(".hub .hub-row", { hasText: LONG_TITLE }).first().waitFor();
      await app.settle();

      const m = await page.evaluate((long) => {
        const rows = [...document.querySelectorAll(".hub .hub-row")];
        const longRows = rows.filter((r) => r.textContent?.includes(long));
        const right = (els: Element[]) =>
          Math.max(0, ...els.map((e) => e.getBoundingClientRect().right));
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          innerWidth: window.innerWidth,
          rows: rows.length,
          chips: document.querySelectorAll(".hub .hub-row .hub-chip").length,
          longRowRight: right(longRows),
          longChipRight: right(longRows.flatMap((r) => [...r.querySelectorAll(".hub-chip")])),
        };
      }, LONG_TITLE);
      expect(m.overflow).toBeLessThanOrEqual(0);
      expect(m.longRowRight).toBeLessThanOrEqual(m.innerWidth);
      expect(m.longChipRight).toBeLessThanOrEqual(m.innerWidth);
      expect(m.chips).toBe(m.rows);
    });
  }
});
