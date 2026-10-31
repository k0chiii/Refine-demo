import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, PAMPHLET, test, WORKS_ENTRY } from "../support/app";

const here = dirname(fileURLToPath(import.meta.url));

const PHASE = process.env.STACK_PR_ACL_PHASE ?? "after";
const OUT =
  process.env.OUT_DIR ??
  resolve(here, `../../../../docs/stack-pr-screenshots/acl-104-106/pr191/${PHASE}`);

mkdirSync(OUT, { recursive: true });

const ADMIN_WORKS_AFTER = 'm3e-action-list[aria-label="制作物ごとの権限"] m3e-list-action';
const ADMIN_WORKS_BEFORE =
  'm3e-action-list[aria-label="制作物ごとの閲覧権限"] m3e-list-action';

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

/** PR #191 UI: ACL ダイアログ・管理リスト・制作物一覧・編集フォーム・情報タブ */
test.describe("stack PR acl UI screenshots", () => {
  test.use({ reducedMotion: "reduce" });

  test(`surfaces ${PHASE}`, async ({ app, page }) => {
    await app.start();

    const adminWorks = PHASE === "after" ? ADMIN_WORKS_AFTER : ADMIN_WORKS_BEFORE;

    await app.signInAs("mock-nogiku-admin");
    await app.go("/works");
    await app.settle();
    if (PHASE === "after") {
      const row = page.locator(WORKS_ENTRY).first();
      await expect(
        row.locator("m3e-icon[name='lock']").or(row.locator(".works-table__lock")),
      ).toHaveCount(0);
    }
    await shot(page, app, "02-works-list.png");

    await app.go("/admin");
    await page.waitForSelector(adminWorks);
    await shot(page, app, "13-admin-works.png");

    await page.locator(adminWorks).first().click();
    await page.waitForSelector("m3e-dialog[open] .acl");
    const header = page.locator("m3e-dialog[open] [slot='header']");
    if (PHASE === "after") {
      await expect(header).toContainText("権限:");
      await expect(header).not.toContainText("閲覧");
      const acl = page.locator("m3e-dialog[open] .acl");
      await expect(acl).not.toContainText("制作物は委員なら誰でも");
      await expect(page.locator("m3e-dialog[open] m3e-icon[name='lock']")).toHaveCount(0);
    } else {
      await expect(header).toContainText("閲覧権限");
    }
    await waitForDialogFullyOpen(page);
    await shot(page, app, "12-acl.png");
    await page
      .locator('m3e-dialog[open] [slot="actions"] m3e-button', { hasText: "閉じる" })
      .click();
    await app.settle();

    await app.signInAs("mock-nogiku-manager");
    await app.openWork(PAMPHLET);
    await app.drawer("情報");
    await page.locator(".drawer__body").evaluate((el, phase) => {
      const sel =
        phase === "after"
          ? ".info-tab__section[aria-label='権限']"
          : ".info-tab__section[aria-label='閲覧権限']";
      el.querySelector(sel)?.scrollIntoView({ block: "start" });
    }, PHASE);
    if (PHASE === "after") {
      await expect(page.locator(".info-tab__section[aria-label='権限']")).toBeVisible();
      await expect(page.getByRole("heading", { name: "閲覧権限" })).toHaveCount(0);
    } else {
      await expect(page.getByRole("heading", { name: "閲覧権限" })).toBeVisible();
    }
    await shot(page, app, "06-editor-info.png");

    await page.getByRole("button", { name: "編集" }).click();
    await page.waitForSelector("m3e-dialog[open] m3e-input-chip");
    if (PHASE === "after") {
      await expect(page.locator("m3e-dialog[open]")).not.toContainText("機密区分");
    }
    await waitForDialogFullyOpen(page);
    await shot(page, app, "15-work-edit.png");
    await page
      .locator('m3e-dialog[open] [slot="actions"] m3e-button', { hasText: "キャンセル" })
      .click();
    await app.settle();
  });
});
