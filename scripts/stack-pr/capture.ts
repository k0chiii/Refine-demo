import { createHash } from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAMPHLET, WORKS_ENTRY } from "../../apps/web/e2e/support/app.ts";

/** 誤ってサインイン画面だけ撮ったときの PNG（大地さん指摘） */
export const SIGNIN_SCREEN_MD5 = "ac741f735c6593b5cbdc397deb4a8004";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/web");
const require = createRequire(path.join(webRoot, "package.json"));
const { chromium } = require("playwright-core");
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
  await demoGo(page, "/signin");
  await page.evaluate(async (s) => {
    await globalThis.__mf100demo!.ensureSeeded();
    await globalThis.__mf100demo!.signIn(s);
  }, sub);
  await page.waitForURL((u) => ["/", "/make", "/check", "/works"].includes(u.pathname), {
    timeout: 30_000,
  });
  await page.waitForTimeout(800);
}

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
    await demoGo(page, "/works");
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
    await page.waitForSelector(".works .ov, .works .kpis, .works", { timeout: 60_000 });
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
