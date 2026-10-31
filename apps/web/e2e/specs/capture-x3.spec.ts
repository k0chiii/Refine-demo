import fs from "node:fs";
import path from "node:path";
import { expect, test } from "../support/app";
import { reviewerComments, submitFirstRevision } from "../support/scenarios";

const repoRoot = path.join(import.meta.dirname, "../../../..");
const outDir = path.join(repoRoot, "docs/stack-pr-screenshots/058");
const fixtures = path.join(repoRoot, "scripts/stack-pr/fixtures");

test("capture x3 / x3b after screenshots", async ({ app, page, browser }) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(fixtures, { recursive: true });

  const { revisionPath } = await submitFirstRevision(app);
  await reviewerComments(app, revisionPath, "団体名の表記が規約と違います。");

  await app.signInAs("mock-nogiku-creator");
  await app.go(revisionPath);
  await app.drawer("コメント");
  const card = app.threads().filter({ hasText: "団体名の表記" });
  await card.locator(".thread__body").click();
  await expect(page.locator(".comments .thread__decide")).toHaveCount(1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "x3-focused-comment.png") });

  const mobile = await browser.newContext({ viewport: { width: 412, height: 800 } });
  const mp = await mobile.newPage();
  await mp.goto("/");
  await mp.waitForFunction(() => typeof globalThis.__mf100demo?.signIn === "function");
  const { App } = await import("../support/app");
  const appM = new App(mp);
  await appM.signInAs("mock-nogiku-creator");
  await appM.go(revisionPath);
  await appM.drawer("コメント");
  await mp.locator(".comments .thread").filter({ hasText: "団体名" }).locator(".thread__body").click();
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: path.join(outDir, "x3b-mobile-focused-comment.png") });
  await mobile.close();

  for (const name of ["x3-focused-comment.png", "x3b-mobile-focused-comment.png"]) {
    fs.copyFileSync(path.join(outDir, name), path.join(fixtures, name));
  }
});
