import fs from "node:fs";
import path from "node:path";
import { test } from "../support/app";
import { assignReviewer, submitFirstRevision } from "../support/scenarios";

const outDir =
  process.env.STACK_PR_E090_DIR ?? path.resolve(import.meta.dirname, "../../../../docs/stack-pr-screenshots/e090");

async function workspaceForScreenshot(
  app: import("../support/app").App,
  page: import("@playwright/test").Page,
) {
  const { workPath } = await submitFirstRevision(app);
  await assignReviewer(app, workPath);
  await app.signInAs("mock-nogiku-reviewer");
  await app.go("/check");
  await page.locator("m3e-list-action", { hasText: "MF100 公式パンフレット" }).first().click();
  await page.waitForURL(/\/works\//);
  await app.pdfReady();
  await page.evaluate(() => localStorage.setItem("mf100.workspace.layout", "panel"));
  await app.drawer("コメント");
  await page.waitForSelector(".comments");
}

test.describe("stack-pr e090 screenshots", () => {
  test.setTimeout(180_000);

  test("before-desktop", async ({ app, page }) => {
    test.skip(process.env.STACK_PR_E090_PHASE !== "before", "before phase only");
    await workspaceForScreenshot(app, page);
    await page.locator(".comments__free").waitFor({ state: "visible" });
    await page.locator(".ws__comment").waitFor({ state: "visible" });
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, "before-desktop.png"), fullPage: true });
  });

  test("before-mobile", async ({ app, page }) => {
    test.skip(process.env.STACK_PR_E090_PHASE !== "before", "before phase only");
    await workspaceForScreenshot(app, page);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.locator(".comments__free").scrollIntoViewIfNeeded();
    await page.locator(".ws__comment").waitFor({ state: "visible" });
    await page.setViewportSize({ width: 412, height: 1400 });
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, "before-mobile.png"), fullPage: true });
  });

  test("after-desktop", async ({ app, page }) => {
    test.skip(process.env.STACK_PR_E090_PHASE !== "after", "after phase only");
    await workspaceForScreenshot(app, page);
    await page.getByRole("button", { name: "全体へのコメント" }).click();
    await page.locator(".compose-pop .rt__content").waitFor({ state: "visible" });
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, "after-desktop.png"), fullPage: true });
  });

  test("after-mobile", async ({ app, page }) => {
    test.skip(process.env.STACK_PR_E090_PHASE !== "after", "after phase only");
    await workspaceForScreenshot(app, page);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.getByRole("button", { name: "全体へのコメント" }).click();
    await page.locator(".compose-pop .rt__content").waitFor({ state: "visible" });
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, "after-mobile.png"), fullPage: true });
  });
});
