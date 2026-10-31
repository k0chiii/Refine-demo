import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/app";

const here = dirname(fileURLToPath(import.meta.url));

const PHASE = process.env.STACK_PR_ACL_PHASE ?? "after";
const OUT =
  process.env.OUT_DIR ??
  resolve(here, `../../../../docs/stack-pr-screenshots/acl-104-106/pr191/${PHASE}`);

mkdirSync(OUT, { recursive: true });

async function waitForDialogFullyOpen(page: Page) {
  await page.locator("m3e-dialog[open]").waitFor({ state: "visible" });
  await page.evaluate(async () => {
    const deadline = performance.now() + 8000;
    const ok = (el: Element | null) => {
      if (!el) return false;
      const s = getComputedStyle(el as HTMLElement);
      return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) >= 0.99;
    };
    while (performance.now() < deadline) {
      const d = document.querySelector("m3e-dialog[open]");
      if (ok(d)) {
        const panel = d?.shadowRoot?.querySelector(".container, .dialog, [part='container']") ?? d;
        if (ok(panel)) return;
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    throw new Error("dialog did not reach full opacity");
  });
}

async function shot(page: Page, app: { settle: () => Promise<void> }, file: string) {
  await app.settle();
  await page.screenshot({ path: resolve(OUT, file) });
}

/** PR #191: 12-acl before (develop) / after (104A UI) */
test.describe("stack PR acl 104 screenshots", () => {
  test.use({ reducedMotion: "reduce" });

  test(`12-acl ${PHASE}`, async ({ app, page }) => {
    await app.start();
    await app.signInAs("mock-nogiku-admin");
    await app.go("/admin");
    await app.settle();
    const adminWorks = 'm3e-action-list[aria-label="制作物ごとの権限"] m3e-list-action';
    await page.waitForSelector(adminWorks);
    await page.locator(adminWorks).first().click();
    await page.waitForSelector("m3e-dialog[open] .acl");
    if (PHASE === "after") {
      const acl = page.locator("m3e-dialog[open] .acl");
      await expect(acl).toContainText("校正・編集・管理");
      await expect(acl).not.toContainText("非公開");
      await expect(acl.locator("m3e-radio", { hasText: /^閲覧$/ })).toHaveCount(0);
    } else {
      await expect(page.locator("m3e-dialog[open] .acl")).toContainText("閲覧");
    }
    await waitForDialogFullyOpen(page);
    await shot(page, app, "12-acl.png");
  });
});
