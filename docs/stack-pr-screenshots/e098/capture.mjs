/**
 * e098 緊急校正: デモ版の before（e082）/ after（e098）スクリーンショット。
 * 用法: node docs/stack-pr-screenshots/e098/capture.mjs --phase before|after
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dir, "../../../apps/web");
const phase = process.argv.includes("--phase")
  ? process.argv[process.argv.indexOf("--phase") + 1]
  : "after";
if (phase !== "before" && phase !== "after") throw new Error("use --phase before|after");

const outDir = path.join(__dir, phase);
fs.mkdirSync(outDir, { recursive: true });

const BASE = "http://127.0.0.1:4173";
const FIXTURE = path.join(root, "e2e/fixtures/sample.pdf");

function ensureDemo() {
  execSync("pnpm build:demo", { cwd: root, stdio: "inherit" });
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
  await page.waitForFunction(() => globalThis.__mf100demo?.signIn, undefined, { timeout: 30_000 });
  await page.evaluate(async () => {
    await globalThis.__mf100demo!.ensureSeeded();
    await globalThis.__mf100demo!.signIn("mock-nogiku-creator");
  });
  await page.waitForURL(/\/(make|check|works)/, { timeout: 30_000 });
}

async function openSubmitDialog(page) {
  await page.goto(`${BASE}/make`);
  await page.waitForLoadState("networkidle");
  const btn = page.getByRole("button", { name: /最初の版を提出|新しい版を提出/ }).first();
  await btn.click({ timeout: 20_000 });
  await page.waitForSelector("m3e-dialog[open]", { timeout: 20_000 });
  await page.waitForSelector('m3e-dialog[open] [slot="header"]', { timeout: 10_000 });
}

async function patchUrgentRevision(page) {
  await page.evaluate(async () => {
    const demo = globalThis.__mf100demo;
    if (!demo) throw new Error("demo missing");
    await demo.enqueue(() =>
      demo.t.run(async (ctx) => {
        const works = await ctx.db.query("works").collect();
        const work = works.find((w) => w.title.includes("公式") || w.lifecycle === "active");
        if (!work) throw new Error("no work");
        const revs = (await ctx.db.query("revisions").collect()).filter(
          (r) => r.workId === work._id && r.reviewState === "open",
        );
        const rev = revs.sort((a, b) => b.sequence - a.sequence)[0];
        if (!rev) throw new Error("no open revision");
        await ctx.db.patch(rev._id, {
          reviewUrgent: true,
          deadlineAt: Date.now() + 6 * 3_600_000,
        });
        return work._id;
      }),
    );
  });
}

async function shot(page, name, assertText) {
  const file = path.join(outDir, `${name}.png`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file, fullPage: false });
  const buf = fs.readFileSync(file);
  if (buf.length < 30_000) throw new Error(`${file} too small: ${buf.length} bytes`);
  if (assertText) {
    const html = await page.content();
    if (!html.includes(assertText)) throw new Error(`${file} missing text: ${assertText}`);
  }
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
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await signIn(page);

if (phase === "before") {
  await openSubmitDialog(page);
  const html = await page.content();
  if (/m3e-filter-chip[\s\S]*緊急|緊急[\s\S]*m3e-filter-chip/.test(html))
    throw new Error("before: 緊急トグルが既に出ている");
  await shot(page, "01-submit-dialog-normal", "校正期日");
} else {
  await openSubmitDialog(page);
  await shot(page, "01-submit-dialog-urgent-off", "校正期日");
  const urgentChip = page.locator("m3e-dialog[open] m3e-filter-chip", { hasText: "緊急" });
  if ((await urgentChip.count()) === 0) throw new Error("after: 緊急 chip が無い");
  await urgentChip.click();
  await shot(page, "02-submit-dialog-urgent-on", "緊急");

  await patchUrgentRevision(page);
  await page.goto(`${BASE}/works`);
  await page.waitForLoadState("networkidle");
  await shot(page, "03-works-list-urgent", "緊急");

  const workLink = page.locator("table a, .mf-table a").first();
  await workLink.click();
  await page.waitForURL(/\/works\//, { timeout: 20_000 });
  await page.waitForSelector(".ws", { timeout: 20_000 });
  await shot(page, "04-editor-subtitle-urgent", "校正中");
}

await browser.close();
assertUniqueMd5(outDir);
console.log(`OK ${phase} -> ${outDir}`);
