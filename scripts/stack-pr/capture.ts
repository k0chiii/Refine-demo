import { createHash } from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { App, PAMPHLET, WORKS_ENTRY, type DemoUser } from "../../apps/web/e2e/support/app.ts";

/** 誤ってサインイン画面だけ撮ったときの PNG（大地さん指摘） */
export const SIGNIN_SCREEN_MD5 = "ac741f735c6593b5cbdc397deb4a8004";

const webRoot = "/workspace/apps/web";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";

let previewStarted = false;

function md5File(file: string) {
  return createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

export function assertNotSigninScreenshot(filePath: string, pagePath: string) {
  if (!fs.existsSync(filePath)) throw new Error(`missing screenshot ${filePath}`);
  const md5 = md5File(filePath);
  if (md5 === SIGNIN_SCREEN_MD5) {
    throw new Error(`signin duplicate md5 on ${filePath} (path was ${pagePath})`);
  }
  if (pagePath.includes("/signin")) {
    throw new Error(`still on signin URL: ${pagePath}`);
  }
}

function ensureDemo() {
  execFileSync("pnpm", ["build:demo"], { cwd: webRoot, stdio: "inherit" });
  if (previewStarted) return;
  execFileSync(
    `mkdir -p e2e/out && setsid sh -c 'echo $$ > e2e/out/preview.pgid; exec pnpm exec vp preview --mode demo --outDir dist-demo --port 4173 --host 127.0.0.1 --strictPort' > e2e/out/preview.log 2>&1 &`,
    { cwd: webRoot, shell: true },
  );
  for (let i = 0; i < 120; i++) {
    try {
      execFileSync("curl", ["-sf", "-o", "/dev/null", `${BASE}/`], { stdio: "ignore" });
      previewStarted = true;
      return;
    } catch {
      execFileSync("sleep", ["1"]);
    }
  }
  throw new Error("demo preview failed to start");
}

type SceneFn = (app: App, page: import("playwright").Page) => Promise<void>;

const SCENES: Record<string, SceneFn> = {
  "01-signin": async (_app, page) => {
    await page.goto(`${BASE}/signin`);
    await new App(page).ready();
    await page.locator("m3e-expansion-panel [slot=header]").first().click();
  },
  "02-works-list": async (app) => {
    await app.signInAs("mock-nogiku-creator");
    await app.go("/works");
    await app.page.waitForSelector(WORKS_ENTRY);
  },
  "27-make-creator": async (app) => {
    await app.signInAs("mock-nogiku-creator");
    await app.go("/make");
    await app.page.waitForSelector(".hub[data-hub='make'] m3e-list-action");
  },
  "28-check-reviewer": async (app) => {
    await app.signInAs("mock-nogiku-reviewer");
    await app.go("/check");
    await app.page.waitForSelector(".hub[data-hub='check']");
  },
  "08-workspace-comment": async (app) => {
    await app.signInAs("mock-nogiku-reviewer");
    await app.go("/works");
    await app.page.locator(WORKS_ENTRY, { hasText: PAMPHLET }).click();
    await app.page.waitForURL(/\/w\//);
    await app.page.waitForSelector(".comments .thread");
  },
  "09-decision": async (app) => {
    await app.signInAs("mock-nogiku-creator");
    await app.go("/works");
    await app.page.locator(WORKS_ENTRY, { hasText: PAMPHLET }).click();
    await app.page.waitForURL(/\/v\//);
    await app.page.waitForSelector(".comments .thread");
  },
  "15-notifications": async (app) => {
    await app.signInAs("mock-nogiku-creator");
    await app.go("/make");
  },
  "31-finalize": async (app) => {
    await app.signInAs("mock-nogiku-approver");
    await app.go("/check");
  },
  "33-work-form": async (app) => {
    await app.signInAs("mock-nogiku-manager");
    await app.go("/works");
  },
  "34-acl": async (app) => {
    await app.signInAs("mock-nogiku-manager");
    await app.go("/works");
  },
  "12-submit-dialog": async (app) => {
    await app.signInAs("mock-nogiku-creator");
    await app.go("/make");
  },
  "dashboard-manager": async (app) => {
    await app.signInAs("mock-nogiku-manager");
    await app.go("/make");
    await app.page.waitForSelector(".hub[data-hub='make'], .home-dashboard, .kpis");
  },
  "dashboard-approver": async (app) => {
    await app.signInAs("mock-nogiku-approver");
    await app.go("/make");
    await app.page.waitForSelector(".hub[data-hub='make'], .home-dashboard, .kpis");
  },
  "dashboard-member": async (app) => {
    await app.signInAs("mock-nogiku-creator");
    await app.go("/make");
    await app.page.waitForSelector(".hub[data-hub='make']");
  },
  "dashboard-manager-mobile": async (app) => {
    await SCENES["dashboard-manager"]!(app, app.page);
  },
  "dashboard-member-mobile": async (app) => {
    await SCENES["dashboard-member"]!(app, app.page);
  },
  "dashboard-approver-mobile": async (app) => {
    await SCENES["dashboard-approver"]!(app, app.page);
  },
  "dashboard-detail": async (app) => {
    await app.signInAs("mock-nogiku-manager");
    await app.openWork(PAMPHLET);
  },
  "dashboard-detail-mobile": async (app) => {
    await SCENES["dashboard-detail"]!(app, app.page);
  },
  "dashboard-manager-dark": async (app, page) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await SCENES["dashboard-manager"]!(app, page);
  },
  "dashboard-manager-dark-mobile": async (app, page) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await SCENES["dashboard-manager"]!(app, page);
  },
  "dashboard-member-tablet": async (app) => {
    await SCENES["dashboard-member"]!(app, app.page);
  },
};

async function runScene(page: import("playwright").Page, key: string) {
  const app = new App(page);
  await page.goto(`${BASE}/signin`);
  await app.ready();
  await app.page.evaluate(() => globalThis.__mf100demo!.ensureSeeded());
  const fn = SCENES[key] ?? SCENES["27-make-creator"]!;
  await fn(app, page);
}

export async function captureShots(
  shots: { desktop: string; mobile?: string },
  prefix: string,
  opts: { mobileWidth?: number } = {},
) {
  ensureDemo();
  const mobileW = opts.mobileWidth ?? 412;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: BASE });
  const page = await desktop.newPage();
  await runScene(page, shots.desktop);
  await page.screenshot({ path: `${prefix}-desktop.png`, fullPage: true });
  assertNotSigninScreenshot(`${prefix}-desktop.png`, new URL(page.url()).pathname);

  if (shots.mobile) {
    const mobile = await browser.newContext({
      viewport: { width: mobileW, height: 915 },
      baseURL: BASE,
    });
    const mp = await mobile.newPage();
    await runScene(mp, shots.mobile ?? shots.desktop);
    await mp.screenshot({ path: `${prefix}-mobile.png`, fullPage: true });
    assertNotSigninScreenshot(`${prefix}-mobile.png`, new URL(mp.url()).pathname);
    await mobile.close();
  }
  await browser.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const prefix = process.argv[2] || "/tmp/shot";
  captureShots({ desktop: "dashboard-member", mobile: "dashboard-member" }, prefix).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
