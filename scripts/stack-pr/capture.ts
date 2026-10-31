import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "../../apps/web/e2e/support/app.ts";
import { PAMPHLET, WORKS_ENTRY } from "../../apps/web/e2e/support/app.ts";
import {
  assertSceneMarkers,
  validateScreenshotFile,
  validateDomSidecar,
  writeSceneDomSidecar,
  SIGNIN_SCREEN_MD5,
} from "./screenshot-validate.ts";

export { SIGNIN_SCREEN_MD5 };

const repoRoot =
  process.env.STACK_PR_REPO ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webRoot = path.join(repoRoot, "apps/web");
const require = createRequire(path.join(webRoot, "package.json"));
const { chromium } = require("playwright-core");
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${process.env.CAPTURE_PORT ?? "4173"}`;
const PREVIEW_PORT = process.env.CAPTURE_PORT ?? "4173";

let previewStarted = false;

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
  const distIndex = path.join(webRoot, "dist-demo/index.html");
  const skipBuild = process.env.SKIP_DEMO_BUILD === "1" && fs.existsSync(distIndex);
  if (!skipBuild) {
    execFileSync("rm", ["-rf", "dist-demo"], { cwd: webRoot });
    execFileSync("pnpm", ["build:demo"], {
      cwd: webRoot,
      stdio: "inherit",
      env: { ...process.env, VP_CACHE: "0" },
    });
  }
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

async function ready(page: Page) {
  await page.waitForFunction(
    () => Boolean(globalThis.__mf100demo && globalThis.__mf100router),
    null,
    {
      timeout: 30_000,
    },
  );
}

/** stack-pr 63B: before/after を同じビルドで撮るとき、実行時にテーマだけ切り替える */
async function applyCaptureTheme(page: Page) {
  const mode = process.env.CAPTURE_THEME;
  if (mode !== "before" && mode !== "after") return;
  const spec =
    mode === "before"
      ? { color: "#1b5fb4", variant: "vibrant" }
      : { color: "#3F51B5", variant: "tonal-spot" };
  await page.evaluate((s) => {
    const t = document.querySelector("m3e-theme");
    if (!t) return;
    t.setAttribute("color", s.color);
    t.setAttribute("variant", s.variant);
  }, spec);
  await page.waitForTimeout(400);
}

async function assertCaptureThemePrimary(page: Page) {
  const mode = process.env.CAPTURE_THEME;
  if (mode !== "before" && mode !== "after") return;
  await page.evaluate((expected) => {
    const t = document.querySelector("m3e-theme");
    if (!t) throw new Error("CAPTURE_THEME: missing m3e-theme");
    const color = t.getAttribute("color")?.toLowerCase();
    const variant = t.getAttribute("variant");
    if (color !== expected.color || variant !== expected.variant) {
      throw new Error(
        `CAPTURE_THEME ${expected.mode}: expected ${expected.color}/${expected.variant}, got ${color}/${variant}`,
      );
    }
    const primary = getComputedStyle(document.documentElement)
      .getPropertyValue("--md-sys-color-primary")
      .trim();
    if (!primary) throw new Error("CAPTURE_THEME: --md-sys-color-primary empty");
  }, mode === "before"
    ? { mode, color: "#1b5fb4", variant: "vibrant" }
    : { mode, color: "#3f51b5", variant: "tonal-spot" });
}

async function demoGo(page: Page, routePath: string) {
  await page.evaluate((p: string) => {
    const path = p.replace(/^https?:\/\/[^/]+/, "");
    const rev = path.match(/^\/works\/([^/]+)\/v\/(\d+)$/);
    if (rev) {
      return globalThis.__mf100router!.navigate({
        to: "/works/$workId/v/$n",
        params: { workId: rev[1]!, n: rev[2]! },
      });
    }
    const work = path.match(/^\/works\/([^/?#]+)$/);
    if (work) {
      return globalThis.__mf100router!.navigate({
        to: "/works/$workId",
        params: { workId: work[1]! },
      });
    }
    const [to, q] = path.split("?");
    const search = q ? Object.fromEntries(new URLSearchParams(q)) : undefined;
    return globalThis.__mf100router!.navigate(search ? { to: to!, search } : { to: to! });
  }, routePath);
  await page.waitForTimeout(800);
}

async function signInAs(page: Page, sub: DemoUser) {
  await page.goto(`${BASE}/signin`);
  await ready(page);
  await page.evaluate(() => globalThis.__mf100demo!.signOut());
  await page.waitForTimeout(300);
  try {
    await page.evaluate(async (s: DemoUser) => {
      await globalThis.__mf100demo!.signIn(s);
    }, sub);
    await page.waitForURL((u: URL) => !u.pathname.includes("/signin"), { timeout: 30_000 });
  } catch {
    await page.goto(`${BASE}/signin`);
    await ready(page);
    const panel = page.locator("m3e-expansion-panel", { hasText: "モック" });
    await panel.locator("[slot=header]").click();
    await page
      .locator("select, m3e-select")
      .first()
      .selectOption(sub)
      .catch(async () => {
        await page.locator("select").first().selectOption(sub);
      });
    await page.getByRole("button", { name: "モックでサインイン" }).click();
    await page.waitForURL((u: URL) => !u.pathname.includes("/signin"), { timeout: 60_000 });
  }
  await page.waitForTimeout(1000);
}

async function openDashboardOverview(page: Page) {
  const panel = page.locator(".ov m3e-expansion-panel, m3e-expansion-panel.ov");
  const header = page.locator("#ov-title, .ov__header");
  if (
    await header
      .first()
      .isVisible()
      .catch(() => false)
  )
    return;
  await panel
    .first()
    .locator("[slot=header]")
    .click({ timeout: 10_000 })
    .catch(() => {});
  await page.locator("#ov-title").waitFor({ state: "visible", timeout: 60_000 });
  await page.locator(".kpis .kpi").first().waitFor({ state: "visible", timeout: 60_000 });
}

async function pdfReady(page: Page) {
  await page.waitForFunction(
    () =>
      ((document.querySelector(".viewer__page canvas") as HTMLCanvasElement | null)?.width ?? 0) >
      0,
    null,
    { timeout: 60_000 },
  );
}

async function openEditorDrawer(page: Page, label: string) {
  await page.waitForSelector(".ws", { timeout: 60_000 });
  const bar = page.locator(".ws__side-toolbar");
  if (await bar.isVisible().catch(() => false)) {
    await bar.locator(`m3e-icon-button[aria-label^="${label}"]`).click({ timeout: 60_000 });
  } else {
    const tab = page.locator(".drawer .pane-tabs m3e-tab", { hasText: label }).first();
    if ((await tab.getAttribute("selected").catch(() => null)) === null) {
      await tab.click({ timeout: 60_000 });
    }
  }
  await page.waitForSelector(".drawer__body", { timeout: 60_000 });
}

const samplePdf = path.join(webRoot, "e2e/fixtures/sample.pdf");

async function seedReviewPamphlet(page: Page) {
  await signInAs(page, "mock-nogiku-creator");
  await demoGo(page, "/works");
  await page.locator(WORKS_ENTRY, { hasText: PAMPHLET }).first().click({ timeout: 60_000 });
  await page.waitForURL(/\/works\/[^/]+$/, { timeout: 60_000 });
  await page
    .locator("m3e-button", { hasText: "最初の版を提出" })
    .first()
    .click({ timeout: 60_000 });
  await page.waitForSelector('m3e-dialog[open] input[type="file"]', { timeout: 60_000 });
  await page.setInputFiles('m3e-dialog[open] input[type="file"]', samplePdf);
  await page.fill("m3e-dialog[open] textarea >> nth=0", "初稿。");
  for (const id of ["theme_font", "balance", "committee_output"]) {
    await page.locator(`m3e-dialog[open] m3e-checkbox#self-check-${id}`).click();
  }
  await page
    .locator("m3e-dialog[open] m3e-button", { hasText: "アップロードを開始" })
    .click({ timeout: 60_000 });
  await page.locator(".upload-item__state--verified").first().waitFor({ timeout: 60_000 });
  await page
    .locator("m3e-dialog[open] m3e-button", { hasText: "提出する" })
    .click({ timeout: 60_000 });
  await page.waitForURL(/\/v\/1$/, { timeout: 60_000 });
  await pdfReady(page);
  const revisionPath = new URL(page.url()).pathname;

  const reviewerName = await page.evaluate(async () => {
    const users = await globalThis.__mf100demo!.users();
    const u = users.find((x) => x.sub === "mock-nogiku-reviewer");
    if (!u) throw new Error("reviewer missing");
    return u.name;
  });

  await signInAs(page, "mock-nogiku-manager");
  await demoGo(page, revisionPath);
  await pdfReady(page);
  await openEditorDrawer(page, "情報");
  await page
    .locator("m3e-button", { hasText: "校正者を割り当てる" })
    .first()
    .click({ timeout: 60_000 });
  await page.waitForSelector('m3e-dialog[open] input[role="combobox"]', { timeout: 60_000 });
  const input = page.locator("m3e-dialog[open] .picker__input").first();
  await input.click();
  await input.fill(reviewerName);
  await page
    .getByRole("option", { name: new RegExp(reviewerName) })
    .first()
    .click({ timeout: 60_000 });
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "保存" }).click({ timeout: 60_000 });
  await page.waitForSelector("m3e-dialog[open]", { state: "detached", timeout: 60_000 });
}

async function workspaceCommentsReady(page: Page) {
  await seedReviewPamphlet(page);
  await signInAs(page, "mock-nogiku-reviewer");
  await demoGo(page, "/check");
  await page.waitForSelector(".hub[data-hub='check'] m3e-list-action", { timeout: 60_000 });
  await page.locator("m3e-list-action", { hasText: PAMPHLET }).first().click({ timeout: 60_000 });
  await page.waitForURL(/\/works\/[^/?#]+/, { timeout: 60_000 });
  await pdfReady(page);
  await page.evaluate(() => localStorage.setItem("mf100.workspace.layout", "panel"));
  await openEditorDrawer(page, "コメント");
  await page.waitForSelector(".comments", { state: "visible", timeout: 60_000 });
  await page
    .locator(".comments__list, .comments__header, .thread-panel, .comments__empty, .thread")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
}

type CaptureSceneOpts = { expandOverview?: boolean; openViewSwitcher?: boolean };
let sceneRunOpts: CaptureSceneOpts = {};

type SceneFn = (page: Page) => Promise<void>;

const SCENES: Record<string, SceneFn> = {
  "01-signin": async (page) => {
    await page.goto(`${BASE}/signin`);
    await ready(page);
    await page.locator("m3e-expansion-panel [slot=header]").first().click();
  },
  "02-works-list": async (page) => {
    await signInAs(page, "mock-nogiku-creator");
    await demoGo(page, "/works");
    await page.waitForSelector(".works", { timeout: 60_000 });
    await page.locator(WORKS_ENTRY).first().waitFor({ state: "attached", timeout: 60_000 });
  },
  "27-make-creator": async (page) => {
    await signInAs(page, "mock-nogiku-creator");
    await demoGo(page, "/make");
    await page.waitForSelector(".hub[data-hub='make']", { timeout: 60_000 });
    if (sceneRunOpts.openViewSwitcher) {
      await page
        .locator(".home-view-switcher")
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });
    }
  },
  "28-check-reviewer": async (page) => {
    await signInAs(page, "mock-nogiku-reviewer");
    await demoGo(page, "/check");
    await page.waitForSelector(".hub[data-hub='check']");
  },
  "08-workspace-comment": async (page) => {
    await workspaceCommentsReady(page);
  },
  "076-before-editor": async (page) => {
    await signInAs(page, "mock-nogiku-manager");
    await demoGo(page, "/works");
    await page.locator(WORKS_ENTRY, { hasText: PAMPHLET }).first().click({ timeout: 60_000 });
    await page.waitForURL(/\/works\/[^/?#]+/, { timeout: 60_000 });
    await page.waitForSelector(".ws", { timeout: 60_000 });
  },
  "e090-before": async (page) => {
    await SCENES["08-workspace-comment"]!(page);
    await page.locator(".comments__free").waitFor({ state: "visible", timeout: 60_000 });
    await page.locator(".ws__comment").waitFor({ state: "visible", timeout: 60_000 });
  },
  "e090-after": async (page) => {
    await SCENES["08-workspace-comment"]!(page);
    await page.getByRole("button", { name: "全体へのコメント" }).click({ timeout: 60_000 });
    await page.locator(".compose-pop .rt__content").waitFor({ state: "visible", timeout: 60_000 });
  },
  "09-decision": async (page) => {
    await signInAs(page, "mock-nogiku-creator");
    await demoGo(page, "/works");
    await page.locator(WORKS_ENTRY, { hasText: PAMPHLET }).click();
    await page.waitForURL(/\/v\//);
    await page.waitForSelector(".comments .thread");
  },
  /** コメント引き出しのヘッダ（解決済み chip。PDF 不要） */
  "editor-comments-header": async (page) => {
    await signInAs(page, "mock-nogiku-reviewer");
    await demoGo(page, "/works");
    await page.locator(WORKS_ENTRY, { hasText: PAMPHLET }).first().click({ timeout: 60_000 });
    await page.waitForURL(/\/works\/[^/?#]+/, { timeout: 60_000 });
    const workId = new URL(page.url()).pathname.match(/\/works\/([^/?#]+)/)?.[1];
    if (workId) {
      await page.evaluate((id: string) => {
        return globalThis.__mf100router!.navigate({
          to: "/works/$workId/v/$n",
          params: { workId: id, n: "1" },
        });
      }, workId);
      await page.waitForTimeout(800);
    }
    await page.waitForSelector(".ws", { timeout: 60_000 });
    await openEditorDrawer(page, "コメント");
    await page.locator(".comments__header").waitFor({ state: "visible", timeout: 60_000 });
  },
  "editor-comments-q66": async (page) => {
    await SCENES["editor-comments-header"]!(page);
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
    await signInAs(page, "mock-nogiku-admin");
    await demoGo(page, "/works?new=true");
    await page.waitForSelector("m3e-dialog[open]", { timeout: 60_000 });
    await page.getByRole("textbox", { name: "制作物名" }).fill("テーマ確認用の制作物");
    await page.locator("m3e-dialog[open] m3e-select").first().click({ timeout: 30_000 });
    await page.getByRole("option").first().click({ timeout: 30_000 });
    const creatorBox = page.getByRole("combobox", { name: /制作者/ });
    await creatorBox.click({ timeout: 30_000 });
    await creatorBox.fill("めい");
    await page.waitForTimeout(800);
    await page.getByRole("option").first().click({ timeout: 30_000 });
    await page
      .locator("m3e-dialog[open] m3e-button", { hasText: "登録" })
      .waitFor({ state: "visible", timeout: 60_000 });
  },
  "q63b-admin-csv": async (page) => {
    await signInAs(page, "mock-nogiku-admin");
    await demoGo(page, "/admin");
    await page
      .locator("m3e-button", { hasText: "CSV で一括登録" })
      .waitFor({ state: "visible", timeout: 60_000 });
  },
  "q63b-admin-register": async (page) => {
    await signInAs(page, "mock-nogiku-admin");
    await demoGo(page, "/admin");
    await page.locator("m3e-button", { hasText: "1 件ずつ登録" }).click({ timeout: 60_000 });
    await page.waitForSelector("m3e-dialog[open]", { timeout: 60_000 });
    await page.getByRole("textbox", { name: "制作物名" }).fill("登録ボタン確認");
    await page.locator("m3e-dialog[open] m3e-select").first().click({ timeout: 30_000 });
    await page.getByRole("option").first().click({ timeout: 30_000 });
    const creatorBox = page.getByRole("combobox", { name: /制作者/ });
    await creatorBox.click({ timeout: 30_000 });
    await creatorBox.fill("めい");
    await page.waitForTimeout(800);
    await page.getByRole("option").first().click({ timeout: 30_000 });
    await page
      .locator("m3e-dialog[open] m3e-button", { hasText: "登録" })
      .waitFor({ state: "visible", timeout: 60_000 });
  },
  "q63b-works-chip": async (page) => {
    await signInAs(page, "mock-nogiku-manager");
    await demoGo(page, "/works");
    await page.waitForSelector(".works__filters m3e-filter-chip", { timeout: 60_000 });
    await page.locator(".works__filters m3e-filter-chip", { hasText: "進行中" }).click({
      timeout: 30_000,
    });
    await page
      .locator(".works__filters m3e-filter-chip[selected]")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  },
  "q63b-works-dashboard": async (page) => {
    await signInAs(page, "mock-nogiku-manager");
    await demoGo(page, "/works");
    await page.waitForSelector(".works", { timeout: 60_000 });
    await openDashboardOverview(page);
    await page.locator("#ov-title, .kpis .kpi").first().waitFor({ state: "visible", timeout: 60_000 });
    await page.locator(".works__controls").waitFor({ state: "visible", timeout: 60_000 });
  },
  "q63b-editor-toolbar": async (page) => {
    await signInAs(page, "mock-nogiku-manager");
    await page.evaluate(() => localStorage.setItem("mf100.workspace.layout", "panel"));
    await demoGo(page, "/works");
    await page.locator(WORKS_ENTRY, { hasText: PAMPHLET }).first().click({ timeout: 60_000 });
    await page.waitForURL(/\/works\/[^/?#]+/, { timeout: 60_000 });
    await page.waitForSelector(".ws", { timeout: 60_000 });
    await page.locator(".ws__side-toolbar:not(.ws__side-toolbar--hidden), .drawer .pane-tabs").first().waitFor({
      state: "visible",
      timeout: 60_000,
    });
  },
  "q63b-admin-tab": async (page) => {
    await signInAs(page, "mock-nogiku-admin");
    await demoGo(page, "/admin?view=teams");
    await page.locator(".page-tabs m3e-tab[selected]").waitFor({ state: "visible", timeout: 60_000 });
  },
  "34-acl": async (page) => {
    await signInAs(page, "mock-nogiku-manager");
    await demoGo(page, "/works");
  },
  "12-submit-dialog": async (page) => {
    await signInAs(page, "mock-nogiku-creator");
    await demoGo(page, "/make");
    const row = page.locator("m3e-list-action", { hasText: "未提出" }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.click({ timeout: 60_000 });
    } else {
      await page.locator("m3e-list-action").first().click({ timeout: 60_000 }).catch(() => {});
    }
    const submit = page.locator("m3e-button", { hasText: "版を提出" }).first();
    if (await submit.isVisible().catch(() => false)) {
      await submit.click({ timeout: 60_000 });
      await page.waitForSelector('m3e-dialog[open] .submit-dialog__title', { timeout: 60_000 });
    }
  },
  "dashboard-manager": async (page) => {
    await signInAs(page, "mock-nogiku-manager");
    await demoGo(page, "/works");
    await page.waitForSelector(".works", { timeout: 60_000 });
    if (sceneRunOpts.expandOverview !== false) await openDashboardOverview(page);
    if (sceneRunOpts.openViewSwitcher) {
      await page
        .locator(".home-view-switcher m3e-segmented-button, .home-view-switcher")
        .first()
        .click({ timeout: 5000 })
        .catch(() => {});
      await page.waitForTimeout(400);
    }
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
    await page.locator(WORKS_ENTRY, { hasText: PAMPHLET }).click({ timeout: 60_000 });
    await page.waitForURL(/\/works\/[^/?#]+/, { timeout: 60_000 });
    const workId = new URL(page.url()).pathname.match(/\/works\/([^/?#]+)/)?.[1];
    if (!workId) throw new Error(`workId not found in ${page.url()}`);
    await page.evaluate((id: string) => {
      return globalThis.__mf100router!.navigate({
        to: "/works/$workId/detail",
        params: { workId: id },
      });
    }, workId);
    await page.waitForSelector(".detail-shell__head, .detail-shell, .ws", { timeout: 60_000 });
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

async function runScene(page: Page, key: string) {
  const skipPamphletComments = process.env.SKIP_PAMPHLET_COMMENTS === "1";
  await page.goto(`${BASE}/signin`);
  await ready(page);
  await page.evaluate((skip) => globalThis.__mf100demo!.ensureSeeded({ skipPamphletComments: skip }), skipPamphletComments);
  const fn = SCENES[key] ?? SCENES["27-make-creator"]!;
  await fn(page);
}

async function captureOne(
  page: Page,
  sceneKey: string,
  outPath: string,
  corpusRoot: string | undefined,
) {
  await runScene(page, sceneKey);
  await applyCaptureTheme(page);
  await assertSceneMarkers(page, sceneKey);
  await assertCaptureThemePrimary(page);
  const pagePath = new URL(page.url()).pathname;
  await page.screenshot({ path: outPath, fullPage: true });
  await writeSceneDomSidecar(page, sceneKey, outPath);
  validateScreenshotFile(outPath, { sceneKey, pagePath, corpusRoot, selfPath: outPath });
  validateDomSidecar(outPath, sceneKey);
}

export async function captureShots(
  shots: { desktop: string; mobile?: string },
  prefix: string,
  opts: {
    mobileWidth?: number;
    mobileHeight?: number;
    desktopWidth?: number;
    desktopHeight?: number;
    expandOverview?: boolean;
    openViewSwitcher?: boolean;
    corpusRoot?: string;
  } = {},
) {
  ensureDemo();
  sceneRunOpts = { expandOverview: opts.expandOverview, openViewSwitcher: opts.openViewSwitcher };
  const corpusRoot = opts.corpusRoot ?? process.env.SCREENSHOT_CORPUS;
  const mobileW = opts.mobileWidth ?? 412;
  const mobileH = opts.mobileHeight ?? 915;
  const desktopW = opts.desktopWidth ?? 1280;
  const desktopH = opts.desktopHeight ?? 900;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const desktop = await browser.newContext({
    viewport: { width: desktopW, height: desktopH },
    deviceScaleFactor: 2,
    baseURL: BASE,
    serviceWorkers: "block",
  });
  await desktop.route("**/*", (route: Route) => {
    route.continue({
      headers: { ...route.request().headers(), "Cache-Control": "no-cache, no-store" },
    });
  });
  const page = await desktop.newPage();
  await captureOne(page, shots.desktop, `${prefix}-desktop.png`, corpusRoot);

  if (shots.mobile) {
    const mobile = await browser.newContext({
      viewport: { width: mobileW, height: mobileH },
      baseURL: BASE,
      serviceWorkers: "block",
    });
    await mobile.route("**/*", (route: Route) => {
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
  captureShots(
    { desktop: scene, mobile: `${scene}-mobile`.replace("-mobile-mobile", "-mobile") },
    prefix,
    {
      corpusRoot: process.env.SCREENSHOT_CORPUS,
    },
  ).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
