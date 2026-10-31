import fs from "node:fs";
import path from "node:path";
import { fixture, PAMPHLET, test } from "../support/app";
import { assignReviewer, submitFirstRevision } from "../support/scenarios";

const outDir =
  process.env.STACK_PR_E090_DIR ?? path.resolve(import.meta.dirname, "../../../../docs/stack-pr-screenshots/e090");
const VIDEO_TITLE = "MF100 告知動画";

async function workspaceForScreenshot(
  app: import("../support/app").App,
  page: import("@playwright/test").Page,
) {
  const { workPath } = await submitFirstRevision(app);
  await assignReviewer(app, workPath);
  await app.signInAs("mock-nogiku-reviewer");
  await app.go("/check");
  await page.locator("m3e-list-action", { hasText: PAMPHLET }).first().click();
  await page.waitForURL(/\/works\//);
  await app.pdfReady();
  await page.evaluate(() => localStorage.setItem("mf100.workspace.layout", "panel"));
  await app.drawer("コメント");
  await page.waitForSelector(".comments");
}

async function videoReviewWorkspace(
  app: import("../support/app").App,
  page: import("@playwright/test").Page,
) {
  await app.signInAs("mock-nogiku-creator");
  const workPath = await app.openWork(VIDEO_TITLE);
  await app.uploadRevision("最初の版を提出", [fixture("promo.webm")], "初稿の告知動画", async () => {
    await app.tickSelfChecks();
  });
  const revisionPath = await app.confirmRevision(1, () =>
    page.waitForFunction(
      () => {
        const v = document.querySelector(".vplayer video");
        return v instanceof HTMLVideoElement && v.readyState >= 1;
      },
      null,
      { timeout: 60_000 },
    ),
  );
  const reviewer = await app.user("mock-nogiku-reviewer");
  await app.signInAs("mock-nogiku-manager");
  await app.go(revisionPath);
  await app.drawer("情報");
  await app.btn("校正者を割り当てる").click();
  await page.waitForSelector('m3e-dialog[open] input[role="combobox"]');
  await app.pickUser(app.dialog(), reviewer.name);
  await app.dialog().locator("m3e-button", { hasText: "保存" }).click();
  await page.waitForSelector("m3e-dialog[open]", { state: "detached" });
  await app.signInAs("mock-nogiku-reviewer");
  await app.go("/check");
  await page.locator("m3e-list-action", { hasText: VIDEO_TITLE }).first().click();
  await page.waitForURL(/\/works\//);
  await page.waitForFunction(
    () => {
      const v = document.querySelector(".vplayer video");
      return v instanceof HTMLVideoElement && v.readyState >= 1;
    },
    null,
    { timeout: 60_000 },
  );
  await page.evaluate(() => localStorage.setItem("mf100.workspace.layout", "panel"));
  await app.drawer("コメント");
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
    await page.locator(".ws__comment", { hasText: "全体コメント" }).waitFor({ state: "visible" });
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

  test("after-video-free-c", async ({ app, page }) => {
    test.skip(process.env.STACK_PR_E090_PHASE !== "after", "after phase only");
    await videoReviewWorkspace(app, page);
    await page.locator(".vplayer").focus();
    await page.keyboard.press("c");
    await page.locator(".compose-pop .rt__content").waitFor({ state: "visible" });
    await page.getByText("位置なし", { exact: false }).first().waitFor({ state: "visible" });
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, "after-video-free-c-desktop.png"), fullPage: true });
  });
});
