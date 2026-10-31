// @ts-nocheck
/** e098 after の 03/04 だけ（01/02 済みのセッション前提で単体実行可） */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dir, "../../../apps/web");
const require = createRequire(path.join(root, "package.json"));
const { chromium } = require("playwright-core");
const outDir = path.join(__dir, "after");
const BASE = "http://127.0.0.1:4173";
const FIXTURE = path.join(root, "e2e/fixtures/sample.pdf");

async function seedUrgent(page) {
  const b64 = fs.readFileSync(FIXTURE).toString("base64");
  await page.evaluate(
    async ({ b64, fileName }) => {
      const demo = globalThis.__mf100demo;
      const api = globalThis.__mf100api;
      const target = (await demo.query(api.home.submitTargets, {})).find((t) =>
        (t.workTitle ?? "").includes("公式"),
      );
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
      const itemId = prepared.items[0].id;
      const sha256 = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
      ]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      await demo.uploadItem(itemId, file, sha256);
      await demo.mutation(api.submissions.confirm, { sessionId: prepared.sessionId });
    },
    { b64, fileName: path.basename(FIXTURE) },
  );
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/google-chrome",
});
const page = await (
  await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" })
).newPage();
await page.goto(`${BASE}/signin`);
await page.waitForFunction(() => globalThis.__mf100demo?.signIn && globalThis.__mf100router);
await page.evaluate(async () => {
  await __mf100demo.ensureSeeded();
  await __mf100demo.signIn("mock-nogiku-creator");
});
await seedUrgent(page);
await page.evaluate(() => void globalThis.__mf100router.navigate({ to: "/works" }));
await page.waitForURL("**/works**", { timeout: 30_000 });
await page.waitForFunction(
  () => document.querySelector(".works-table")?.textContent?.includes("緊急"),
  undefined,
  { timeout: 120_000 },
);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(outDir, "03-works-list-urgent.png") });
const workId = await page.evaluate(async () => {
  const api = globalThis.__mf100api;
  const res = await globalThis.__mf100demo.query(api.works.listMinePage, {
    paginationOpts: { numItems: 50, cursor: null },
  });
  return res.page.find((w) => w.title.includes("公式"))?.id;
});
await page.evaluate(
  ({ workId }) => {
    void globalThis.__mf100router.navigate({
      to: "/works/$workId/v/$n",
      params: { workId, n: "1" },
    });
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
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(outDir, "04-editor-subtitle-urgent.png") });
await browser.close();
for (const f of fs.readdirSync(outDir).filter((x) => x.endsWith(".png"))) {
  const buf = fs.readFileSync(path.join(outDir, f));
  if (buf.length < 30_000) throw new Error(`${f} too small`);
}
console.log("OK 03/04");
