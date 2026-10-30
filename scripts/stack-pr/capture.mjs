import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const repoRoot = process.env.STACK_PR_REPO ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(repoRoot, "apps/web/package.json"));
const { chromium } = require("playwright-core");

const root = path.join(repoRoot, "apps/web");
const routes = {
  "01-signin": "/signin",
  "02-works-list": "/works",
  "08-workspace-comment": null,
  "09-decision": null,
  "27-make-creator": "/make",
  "28-check-reviewer": "/check",
  "15-notifications": "/make",
  "31-finalize": "/check",
  "33-work-form": "/works",
  "34-acl": "/works",
  "12-submit-dialog": "/make",
  "78-thread-panel": null,
};

let previewStarted = false;

function ensureDemo() {
  execSync("pnpm build:demo", { cwd: root, stdio: "inherit" });
  if (previewStarted) return;
  execSync(
    `mkdir -p e2e/out && setsid sh -c 'echo $$ > e2e/out/preview.pgid; exec pnpm exec vp preview --mode demo --outDir dist-demo --port 4173 --host 127.0.0.1 --strictPort' > e2e/out/preview.log 2>&1 &`,
    { cwd: root, shell: true },
  );
  for (let i = 0; i < 90; i++) {
    try {
      execSync("curl -sf -o /dev/null http://127.0.0.1:4173/", { stdio: "ignore" });
      previewStarted = true;
      return;
    } catch {
      execSync("sleep 1");
    }
  }
  throw new Error("demo preview failed to start");
}

async function signIn(page) {
  await page.goto("http://127.0.0.1:4173/signin");
  await page.getByRole("button", { name: /大地|demo|nogiku/i }).first().click({ timeout: 15000 }).catch(async () => {
    await page.getByRole("button").first().click();
  });
  await page.waitForURL(/\/(make|check|works)/, { timeout: 30000 });
}

export async function captureShots(shots, prefix) {
  ensureDemo();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  await signIn(page);
  const key = shots.desktop;
  const route = routes[key] ?? "/make";
  if (route) await page.goto(`http://127.0.0.1:4173${route}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${prefix}-desktop.png`, fullPage: true });

  if (shots.mobile) {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mp = await mobile.newPage();
    await signIn(mp);
    if (route) await mp.goto(`http://127.0.0.1:4173${route}`);
    await mp.waitForTimeout(800);
    await mp.screenshot({ path: `${prefix}-mobile.png`, fullPage: true });
    await mobile.close();
  }
  await browser.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const prefix = process.argv[2] || "/tmp/shot";
  captureShots({ desktop: "27-make-creator" }, prefix).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
