import { createHash } from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAMPHLET, WORKS_ENTRY } from "../../apps/web/e2e/support/app.ts";
import {
  assertSceneMarkers,
  validateScreenshotFile,
  SIGNIN_SCREEN_MD5,
} from "./screenshot-validate.ts";

export { SIGNIN_SCREEN_MD5 };

const repoRoot = process.env.STACK_PR_REPO ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webRoot = path.join(repoRoot, "apps/web");
const require = createRequire(path.join(webRoot, "package.json"));
const { chromium } = require("playwright-core");
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${process.env.CAPTURE_PORT ?? "4173"}`;
const PREVIEW_PORT = process.env.CAPTURE_PORT ?? "4173";

let previewStarted = false;

function md5File(file: string) {
  return createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

export function assertNotSigninScreenshot(filePath: string, pagePath: string) {
  validateScreenshotFile(filePath, {
    sceneKey: "_legacy",
    pagePath,
    corpusRoot: process.env.SCREENSHOT_CORPUS,
    selfPath: filePath,
  });
}

function ensureDemo() {
  try {
    execFileSync("fuser", [`-k`, `${PREVIEW_PORT}/tcp`], { stdio: "ignore" });
  } catch {
    /* port free */
  }
  previewStarted = false;
  execFileSync("sleep", ["1"]);
  execFileSync("rm", ["-rf", "dist-demo"], { cwd: webRoot });
  execFileSync("pnpm", ["build:demo"], {
    cwd: webRoot,
    stdio: "inherit",
    env: { ...process.env, VP_CACHE: "0" },
  });
  if (previewStarted) return;
  execFileSync(
    `mkdir -p e2e/out && setsid sh -c 'echo $$ > e2e/out/preview.pgid; exec pnpm exec vp preview --mode demo --outDir dist-demo --port ${PREVIEW_PORT} --host 127.0.0.1 --strictPort' > e2e/out/preview.log 2>&1 &`,
    { cwd: webRoot, shell: true },
  );
  for (let i = 0; i < 120; i++) {
    try {
      execFileSync("curl", ["-sf", "-o", "/dev/null", `${BASE}/`], { stdio: "ignore" });
      previewStarted = true;
      execFileSync("sleep", ["2"]);
      return;
    } catch {
      execFileSync("sleep", ["1"]);
    }
  }
  throw new Error("demo preview failed to start");
}

type DemoUser =
  | "mock-nogiku-creator"
  | "mock-nogiku-reviewer"
  | "mock-nogiku-manager"
  | "mock-nogiku-approver";

async function ready(page: import("playwright").Page) {
  await page.waitForFunction(() => Boolean(globalThis.__mf100demo && globalThis.__mf100router), null, {
    timeout: 30_000,
  });
}

async function demoGo(page: import("playwright").Page, routePath: string) {
  await page.evaluate((p) => {
    const [to, q] = p.split("?");
    const search = q ? Object.fromEntries(new URLSearchParams(q)) : undefined;
    return globalThis.__mf100router!.navigate(search ? { to: to!, search } : { to: to! });
  }, routePath.replace(/^https?:\/\/[^/]+/, ""));
  await page.waitForTimeout(800);
}

async function signInAs(page: import("playwright").Page, sub: DemoUser) {
  await page.goto(`${BASE}/signin`);
  await ready(page);
  await page.evaluate(() => globalThis.__mf100demo!.signOut());
  await page.waitForTimeout(300);
  try {
    await page.evaluate(async (s) => {
      await globalThis.__mf100demo!.ensureSeeded();
      await globalThis.__mf100demo!.signIn(s);
    }, sub);
    await page.waitForURL((u) => !u.pathname.includes("/signin"), { timeout: 30_000 });
  } catch {
    await page.goto(`${BASE}/signin`);
    await ready(page);
    const panel = page.locator("m3e-expansion-panel", { hasText: "モック" });
    await panel.locator("[slot=header]").click();
    await page.locator('select, m3e-select').first().selectOption(sub).catch(async () => {
      await page.locator("select").first().selectOption(sub);
    });
    await page.getByRole("button", { name: "モックでサインイン" }).click();
    await page.waitForURL((u) => !u.pathname.includes("/signin"), { timeout: 60_000 });
  }
  await page.waitForTimeout(1000);
}

async function openDashboardOverview(page: import("playwright").Page) {
  const panel = page.locator(".ov m3e-expansion-panel, m3e-expansion-panel.ov");
  const header = page.locator("#ov-title, .ov__header");
  if (await header.first().isVisible().catch(() => false)) return;
  await panel.first().locator("[slot=header]").click({ timeout: 10_000 }).catch(() => {});
  await page.locator("#ov-title").waitFor({ state: "visible", timeout: 60_000 });
  await page.locator(".kpis .kpi").first().waitFor({ state: "visible", timeout: 60_000 });
}

type CaptureSceneOpts = { expandOverview?: boolean };
let sceneRunOpts: CaptureSceneOpts = {};

type SceneFn = (page: import("playwright").Page) => Promise<void>;

const SCENES: Record<string, SceneFn> = {
  "01-signin": async (page) => {
    await page.goto(`${BASE}/signin`);
    await ready(page);
    await page.locator("m3e-expansion-panel [slot=header]").first().click();
  },
  "02-works-list": async (page) => {
    await signInAs(page, "mock-nogiku-creator");
    await demoGo(page, "/works");
    await page.waitForSelector(WORKS_ENTRY);
  },
  "27-make-creator": async (page) => {
    await signInAs(page, "mock-nogiku-creator");
    await demoGo(page, "/make");
    await page.waitForSelector(".hub[data-hub='make'] m3e-list-action");
  },
  "28-check-reviewer": async (page) => {
    await signInAs(page, "mock-nogiku-reviewer");
    await demoGo(page, "/check");
    await page.waitForSelector(".hub[data-hub='check']");
  },
  "08-workspace-comment": async (page) => {
    await signInAs(page, "mock-nogiku-reviewer");
    await demoGo(page, "/works");
    await page.locator(WORKS_ENTRY, { hasText: PAMPHLET }).click();
    await page.waitForURL(/\/w\//);
    await page.waitForSelector(".comments .thread");
  },
  "09-decision": async (page) => {
    await signInAs(page, "mock-nogiku-creator");
    await demoGo(page, "/works");
    await page.locator(WORKS_ENTRY, { hasText: PAMPHLET }).click();
    await page.waitForURL(/\/v\//);
    await page.waitForSelector(".comments .thread");
  },
  "15-notifications": async (page) => {
    await signInAs(page, "mock-nogiku-creator");
    await demoGo(page, "/make");
  },
  "31-finalize": async (page) => {
    await signInAs(page, "mock-nogiku-approver");
    await demoGo(page, "/check");
  },
  "33-work-form": async (page) => {
    await signInAs(page, "mock-nogiku-manager");
    await demoGo(page, "/works?new=true");
    await page.waitForSelector("m3e-dialog[open]", { timeout: 60_000 });
    const detailLegacy = page.locator("m3e-expansion-panel", { hasText: "制作物 ID" });
    if (await detailLegacy.count()) {
      await detailLegacy.first().locator("[slot=header]").click();
      await page.waitForTimeout(400);
    }
    const body = page.locator("m3e-dialog[open] .dialog-body");
    if (await body.count()) {
      await body.first().evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
    }
    await page.waitForTimeout(400);
  },
  "34-acl": async (page) => {
    await signInAs(page, "mock-nogiku-manager");
    await demoGo(page, "/works");
  },
  "12-submit-dialog": async (page) => {
    await signInAs(page, "mock-nogiku-creator");
    await demoGo(page, "/make");
  },
  "dashboard-manager": async (page) => {
    await signInAs(page, "mock-nogiku-manager");
    await demoGo(page, "/works");
    await page.waitForSelector(".works", { timeout: 60_000 });
    if (sceneRunOpts.expandOverview !== false) await openDashboardOverview(page);
  },
  "dashboard-approver": async (page) => {
    await signInAs(page, "mock-nogiku-approver");
    await demoGo(page, "/works");
    await page.waitForSelector(".works, .hub[data-hub='make']", { timeout: 60_000 });
  },
  "dashboard-member": async (page) => {
    await signInAs(page, "mock-nogiku-creator");
    await demoGo(page, "/make");
    await page.waitForSelector(".hub[data-hub='make']");
  },
  "dashboard-manager-mobile": async (page) => {
    await SCENES["dashboard-manager"]!(page);
  },
  "dashboard-member-mobile": async (page) => {
    await SCENES["dashboard-member"]!(page);
  },
  "dashboard-approver-mobile": async (page) => {
    await SCENES["dashboard-approver"]!(page);
  },
  "dashboard-detail": async (page) => {
    await signInAs(page, "mock-nogiku-manager");
    await demoGo(page, "/works");
    await page.locator(WORKS_ENTRY, { hasText: PAMPHLET }).click();
    await page.waitForURL(/\/w\//);
  },
  "dashboard-detail-mobile": async (page) => {
    await SCENES["dashboard-detail"]!(page);
  },
  "dashboard-manager-dark": async (page) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await SCENES["dashboard-manager"]!(page);
  },
  "dashboard-manager-dark-mobile": async (page) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await SCENES["dashboard-manager"]!(page);
  },
  "dashboard-member-tablet": async (page) => {
    await SCENES["dashboard-member"]!(page);
  },
};

async function runScene(page: import("playwright").Page, key: string) {
  await page.goto(`${BASE}/signin`);
  await ready(page);
  await page.evaluate(() => globalThis.__mf100demo!.ensureSeeded());
  const fn = SCENES[key] ?? SCENES["27-make-creator"]!;
  await fn(page);
}

async function captureOne(
  page: import("playwright").Page,
  sceneKey: string,
  outPath: string,
  corpusRoot: string | undefined,
) {
  await runScene(page, sceneKey);
  await assertSceneMarkers(page, sceneKey);
  const pagePath = new URL(page.url()).pathname;
  await page.screenshot({ path: outPath, fullPage: true });
  validateScreenshotFile(outPath, { sceneKey, pagePath, corpusRoot, selfPath: outPath });
}

export async function captureShots(
  shots: { desktop: string; mobile?: string },
  prefix: string,
  opts: { mobileWidth?: number; expandOverview?: boolean; corpusRoot?: string } = {},
) {
  ensureDemo();
  sceneRunOpts = { expandOverview: opts.expandOverview };
  const corpusRoot = opts.corpusRoot ?? process.env.SCREENSHOT_CORPUS;
  const mobileW = opts.mobileWidth ?? 412;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    baseURL: BASE,
    serviceWorkers: "block",
  });
  await desktop.route("**/*", (route) => {
    route.continue({
      headers: { ...route.request().headers(), "Cache-Control": "no-cache, no-store" },
    });
  });
  const page = await desktop.newPage();
  await captureOne(page, shots.desktop, `${prefix}-desktop.png`, corpusRoot);

  if (shots.mobile) {
    const mobile = await browser.newContext({
      viewport: { width: mobileW, height: 915 },
      baseURL: BASE,
      serviceWorkers: "block",
    });
    await mobile.route("**/*", (route) => {
      route.continue({
        headers: { ...route.request().headers(), "Cache-Control": "no-cache, no-store" },
      });
    });
    const mp = await mobile.newPage();
    await captureOne(mp, shots.mobile ?? shots.desktop, `${prefix}-mobile.png`, corpusRoot);
    await mobile.close();
  }
  await browser.close();
  try {
    execFileSync("pkill", ["-f", "vp preview"], { stdio: "ignore" });
  } catch {
    /* none */
  }
}

if (process.argv[1]?.includes("capture.ts")) {
  const prefix = process.argv[2] || "/tmp/shot";
  const scene = process.env.CAPTURE_SCENE || "dashboard-manager";
  captureShots({ desktop: scene, mobile: `${scene}-mobile`.replace("-mobile-mobile", "-mobile") }, prefix, {
    corpusRoot: process.env.SCREENSHOT_CORPUS,
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
