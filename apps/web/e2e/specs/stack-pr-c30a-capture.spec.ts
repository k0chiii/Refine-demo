import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, PAMPHLET, test, type Page } from "../support/app";

const SLIDE_DECK = "企画説明会スライド";

const PR = process.env.STACK_PR_C30A ?? "87";
const PHASE = process.env.STACK_PR_C30A_PHASE ?? "after";
const OUT = process.env.OUT_DIR ?? resolve(`docs/stack-pr-screenshots/c30a-pr${PR}/${PHASE}`);

mkdirSync(OUT, { recursive: true });

async function assertNoLegacyVisibleCopy(page: Page) {
  await expect(page.getByText("あなたの番", { exact: false })).toHaveCount(0);
  const demoOutsideDialog = await page.evaluate(() => {
    const open = document.querySelector("m3e-dialog[open]");
    const visible = (el: Element) => {
      const h = el as HTMLElement;
      const s = getComputedStyle(h);
      return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
    };
    const scan = (root: Document | ShadowRoot): boolean => {
      for (const el of root.querySelectorAll("*")) {
        if (el instanceof HTMLElement && el.shadowRoot && scan(el.shadowRoot)) return true;
        if (!(el instanceof HTMLElement) || !visible(el)) continue;
        if (open && (open === el || open.contains(el))) continue;
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && /^デモ:/.test((node.textContent ?? "").trim()))
            return true;
        }
      }
      return false;
    };
    return scan(document);
  });
  expect(demoOutsideDialog).toBe(false);
}

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
  await assertNoLegacyVisibleCopy(page);
  await app.settle();
  await page.screenshot({ path: resolve(OUT, file) });
}

/**
 * スタック PR #86–#88（c30a）の before/after 用。
 * STACK_PR_C30A=86|87|88, STACK_PR_C30A_PHASE=before|after, OUT_DIR=…
 */
test.describe("stack PR c30a screenshots", () => {
  test.use({ reducedMotion: "reduce" });

  test(`PR #${PR} ${PHASE}`, async ({ app, page }) => {
    await app.start();

    if (PR === "86") {
      await app.signInAs("mock-nogiku-manager");
      await app.go("/works");
      await app.settle();
      const row = page.locator(".works .works-table tbody tr", { hasText: PAMPHLET }).first();
      await app.openMenu(row.locator(`m3e-icon-button[aria-label="${PAMPHLET} の操作"]`));
      const menu = row.locator("m3e-menu");
      if (PHASE === "after") {
        await expect(menu.locator("m3e-menu-item", { hasText: "制作者を変更" })).toBeVisible();
        await menu.locator("m3e-menu-item", { hasText: "制作者を変更" }).click();
        await expect(app.dialog()).toContainText("制作者を変更");
        await waitForDialogFullyOpen(page);
        await shot(page, app, "transfer-creators-dialog.png");
      } else {
        await expect(menu.locator("m3e-menu-item", { hasText: "制作者を変更" })).toHaveCount(0);
        await page.keyboard.press("Escape");
        await shot(page, app, "works-row-menu.png");
      }
      return;
    }

    if (PR === "87") {
      await app.signInAs("mock-nogiku-creator");
      const title = PHASE === "after" ? SLIDE_DECK : PAMPHLET;
      await app.openWork(title);
      await app.btn("最初の版を提出").click();
      const dialog = app.dialog();
      await expect(dialog).toBeVisible();
      await app.settle();
      if (PHASE === "after") {
        await expect(dialog).toContainText("PDF（必須、校正対象）");
        await expect(dialog).toContainText("スライドのリンク");
        await expect(
          dialog.locator(".file-drop .field", { hasText: "スライドのリンク" }),
        ).toHaveCount(0);
        await expect(dialog.locator(".field", { hasText: "スライドのリンク" })).toBeVisible();
      } else {
        await expect(dialog).not.toContainText("スライドのリンク");
      }
      await waitForDialogFullyOpen(page);
      await shot(page, app, "submit-dialog.png");
      return;
    }

    if (PR === "88") {
      await app.signInAs("mock-nogiku-creator");
      await app.openNotificationSettings();
      await waitForDialogFullyOpen(page);
      const slack = app.notificationChannel("slack");
      if (PHASE === "after") {
        await expect(slack).toHaveCount(0);
        await expect(page.locator("m3e-dialog[open]")).toContainText("Nogiku のメールアドレス");
      } else {
        await expect(slack).toHaveCount(1);
        await expect(slack).toContainText("Slack");
      }
      await shot(page, app, "notification-settings.png");
    }
  });
});
