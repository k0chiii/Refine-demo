/**
 * e098 緊急校正: デモ版の before（e082）/ after（e098）スクリーンショット。
 * 用法: node docs/stack-pr-screenshots/e098/capture.mjs --phase before|after
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.MF100_WEB_ROOT
  ? path.resolve(process.env.MF100_WEB_ROOT)
  : path.resolve(__dir, "../../../apps/web");
const require = createRequire(path.join(root, "package.json"));
const { chromium } = require("playwright-core");
const phase = process.argv.includes("--phase")
  ? process.argv[process.argv.indexOf("--phase") + 1]
  : "after";
if (phase !== "before" && phase !== "after") throw new Error("use --phase before|after");

const outDir = path.join(__dir, phase);
fs.mkdirSync(outDir, { recursive: true });

const BASE = "http://127.0.0.1:4173";
const FIXTURE = path.join(root, "e2e/fixtures/sample.pdf");

async function navTo(page, to) {
  const pathNow = new URL(page.url()).pathname;
  if (pathNow === to || (to !== "/" && pathNow.startsWith(`${to}/`))) return;
  const item = page.locator(`m3e-nav-item[data-to="${to}"]`).first();
  if ((await item.count()) > 0) {
    await item.click();
  } else {
    await page.evaluate((path) => {
      globalThis.__mf100router?.navigate({ to: path });
    }, to);
  }
  await page.waitForURL((u) => u.pathname === to || u.pathname.startsWith(`${to}/`), { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

async function openSubmitDialog(page) {
  await navTo(page, "/make");
  await page.locator('m3e-nav-rail m3e-fab[aria-label="作る"], m3e-fab[aria-label="作る"]').first().click();
  await page.locator("#make-menu m3e-menu-item", { hasText: "版を提出" }).click();
  await page.locator("m3e-dialog.submit-picker[open] m3e-list-action", { hasText: "MF100 公式パンフレット" }).click({
    timeout: 30_000,
  });
  await page.waitForSelector("m3e-dialog[open].dialog--full", { timeout: 30_000 });
  await page.locator(".submit-dialog__header m3e-filter-chip").first().waitFor({ state: "attached", timeout: 30_000 }).catch(() => {});
}

async function assertUrgentChipTypography(page) {
  const fonts = await page.evaluate(() => {
    const title = document.querySelector(".submit-dialog__title, .submit-dialog__header > span");
    const chip = document.querySelector(".submit-dialog__header m3e-filter-chip");
    if (!title || !chip) return null;
    const ts = getComputedStyle(title);
    const cs = getComputedStyle(chip);
    return {
      titleSize: parseFloat(ts.fontSize),
      chipSize: parseFloat(cs.fontSize),
      titleFamily: ts.fontFamily,
      chipFamily: cs.fontFamily,
    };
  });
  if (!fonts) throw new Error("typography: submit-dialog header or chip missing");
  if (fonts.chipSize > fonts.titleSize + 0.5)
    throw new Error(`typography: 緊急 chip ${fonts.chipSize}px > 見出し ${fonts.titleSize}px`);
  if (fonts.titleFamily !== fonts.chipFamily) throw new Error("typography: font-family mismatch");
}

function ensureDemo() {
  try {
    execSync("fuser -k 4173/tcp 2>/dev/null || true", { stdio: "ignore", shell: true });
    execSync("pkill -9 -f 'vp preview.*4173' 2>/dev/null || true", { stdio: "ignore", shell: true });
    execSync("sleep 1");
  } catch {
    /* no preview */
  }
  execSync("rm -rf dist-demo", { cwd: root, stdio: "ignore" });
  execSync("pnpm exec vp run @mf100/convex#generate-convex", { cwd: root, stdio: "inherit" });
  execSync("pnpm exec vp build --mode demo --outDir dist-demo", { cwd: root, stdio: "inherit" });
  const chunk = fs
    .readdirSync(path.join(root, "dist-demo/assets"))
    .find((f) => f.startsWith("SubmitDialog-") && f.endsWith(".js"));
  if (!chunk) throw new Error("dist-demo: SubmitDialog chunk missing");
  const src = fs.readFileSync(path.join(root, "dist-demo/assets", chunk), "utf8");
  if (!src.includes("校正期日") || !src.includes("緊急")) {
    throw new Error("dist-demo SubmitDialog is not e098 (missing 校正期日/緊急)");
  }
  execSync(
    `mkdir -p e2e/out && setsid sh -c 'echo $$ > e2e/out/preview-e098.pgid; exec pnpm exec vp preview --mode demo --outDir dist-demo --port 4173 --host 127.0.0.1 --strictPort' > e2e/out/preview-e098.log 2>&1 &`,
    { cwd: root, shell: true },
  );
  for (let i = 0; i < 120; i++) {
    try {
      execSync(`curl -sf -o /dev/null ${BASE}/`, { stdio: "ignore" });
      return;
    } catch {
      execSync("sleep 1");
    }
  }
  throw new Error("demo preview did not start");
}

async function signIn(page) {
  await page.goto(`${BASE}/signin`);
  await page.waitForFunction(() => globalThis.__mf100demo?.signIn && globalThis.__mf100router, undefined, {
    timeout: 30_000,
  });
  await page.evaluate(async () => {
    const demo = globalThis.__mf100demo;
    if (!demo) throw new Error("__mf100demo missing");
    await demo.ensureSeeded();
    await demo.signIn("mock-nogiku-creator");
  });
  await page.waitForURL(/\/(make|check|works)/, { timeout: 30_000 });
}

async function seedUrgentRevision(page) {
  const pdf = fs.readFileSync(FIXTURE);
  const b64 = pdf.toString("base64");
  return page.evaluate(
    async ({ b64, fileName }) => {
      const demo = globalThis.__mf100demo;
      const api = globalThis.__mf100api;
      if (!demo || !api) throw new Error("demo/api missing");
      const targets = await demo.query(api.home.submitTargets, {});
      const target = targets.find((t) => (t.workTitle ?? t.title ?? "").includes("公式"));
      if (!target) throw new Error("submit target missing");
      const deadlineAt = Date.now() + 6 * 3_600_000;
      const blob = await fetch(`data:application/pdf;base64,${b64}`).then((r) => r.blob());
      const file = new File([blob], fileName, { type: "application/pdf" });
      const prepared = await demo.mutation(api.submissions.prepare, {
        workId: target.workId,
        kind: "standard",
        reviewType: "general",
        reviewUrgent: true,
        deadlineAt,
        changeSummary: "e098 スクリーンショット用",
        focusNotes: "",
        items: [
          {
            fileName,
            mimeType: "application/pdf",
            type: "pdf",
            role: "source",
            declaredSize: file.size,
          },
        ],
      });
      const itemId = prepared.items[0]?.id;
      if (!itemId) throw new Error("prepare item missing");
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      await demo.uploadItem(itemId, file, sha256);
      const confirmed = await demo.mutation(api.submissions.confirm, { sessionId: prepared.sessionId });
      if (!confirmed?.revisionId) throw new Error("confirm failed");
      return target.workId;
    },
    { b64, fileName: path.basename(FIXTURE) },
  );
}

async function shot(page, name, assertFn) {
  const file = path.join(outDir, `${name}.png`);
  if (assertFn) await assertFn(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file, fullPage: false });
  const buf = fs.readFileSync(file);
  if (buf.length < 30_000) throw new Error(`${file} too small: ${buf.length} bytes`);
  return file;
}

function assertUniqueMd5(dir) {
  const hashes = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".png"))) {
    const h = createHash("md5").update(fs.readFileSync(path.join(dir, f))).digest("hex");
    if (hashes.has(h)) throw new Error(`duplicate md5 ${h}: ${hashes.get(h)} and ${f}`);
    hashes.set(h, f);
  }
}

ensureDemo();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/google-chrome",
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: "block",
});
const page = await ctx.newPage();

await signIn(page);

if (phase === "before") {
  await openSubmitDialog(page);
  const html = await page.content();
  if (/m3e-filter-chip[\s\S]*緊急|緊急[\s\S]*m3e-filter-chip/.test(html))
    throw new Error("before: 緊急トグルが既に出ている");
  await shot(page, "01-submit-dialog-normal", async (p) => {
    await p.getByText("校正期限", { exact: false }).first().waitFor({ state: "visible", timeout: 30_000 });
  });
} else {
  await openSubmitDialog(page);
  await shot(page, "01-submit-dialog-urgent-off", async (p) => {
    await p.getByText("版を提出", { exact: true }).first().waitFor({ state: "visible" });
    await p.locator("m3e-dialog[open].dialog--full m3e-date-input").waitFor({ state: "visible", timeout: 30_000 });
  });
  const urgentChip = page.locator(".submit-dialog__header m3e-filter-chip").filter({ hasText: "緊急" });
  if ((await urgentChip.count()) === 0) throw new Error("after: 緊急 chip が無い");
  await urgentChip.click();
  await shot(page, "02-submit-dialog-urgent-on", async (p) => {
    await p
      .locator(".submit-dialog__header m3e-filter-chip")
      .filter({ hasText: "緊急" })
      .waitFor({ state: "visible" });
    await assertUrgentChipTypography(p);
  });
  await page.keyboard.press("Escape");
  await page.waitForSelector("m3e-dialog[open]", { state: "detached", timeout: 10_000 }).catch(() => {});
  for (let i = 0; i < 5 && (await page.locator("m3e-dialog[open]").count()) > 0; i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  const workId = await seedUrgentRevision(page);
  await page.evaluate(() => {
    globalThis.__mf100router?.navigate({ to: "/works" });
  });
  await page.waitForURL("**/works**", { timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector(".works-table")?.textContent?.includes("緊急"),
    undefined,
    { timeout: 120_000 },
  );
  await shot(page, "03-works-list-urgent", async (p) => {
    await p
      .locator(".works-table")
      .getByText("緊急", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });
  });

  await page.evaluate(
    ({ workId }) => {
      globalThis.__mf100router?.navigate({ to: "/works/$workId/v/$n", params: { workId, n: "1" } });
    },
    { workId },
  );
  await page.waitForURL(/\/works\/[^/]+\/v\/1/, { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const sub = document.querySelector('m3e-app-bar [slot="subtitle"]');
      return sub?.textContent?.includes("緊急") && sub.textContent.includes("校正期日");
    },
    undefined,
    { timeout: 120_000 },
  );
  await shot(page, "04-editor-subtitle-urgent", async (p) => {
    await p.locator('m3e-app-bar [slot="subtitle"]').getByText("緊急").first().waitFor({ state: "visible" });
  });
}

await browser.close();
assertUniqueMd5(outDir);
console.log(`OK ${phase} -> ${outDir}`);
