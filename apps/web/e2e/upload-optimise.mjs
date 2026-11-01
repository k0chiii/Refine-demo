/**
 * アップロード時の可逆な最適化を本物のブラウザ（Chromium）で確かめる（利用者指示 2026-10-19「劣化ゼロだけ」）。
 *   1) pnpm build:demo && pnpm exec vp preview --mode demo --outDir dist-demo --port 4390
 *   2) CHROMIUM_PATH=... BASE_URL=http://127.0.0.1:4390 node e2e/upload-optimise.mjs
 * - PNG: Worker（WASM）で作り直され、画素が同じことを復号して突き合わせた結果だけが上がる
 * - ダウンロード専用の原本（.psd）: gzip で上がり、ダウンロードすると元のバイト列に戻る
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const FIXTURES = resolve(here, "fixtures");

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ja-JP" })
).newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

const expectTrue = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const settle = () => page.waitForTimeout(400);
const btn = (text) => page.locator("m3e-button", { hasText: text }).first();

try {
  await page.goto(`${BASE}/signin`);
  await page.waitForFunction(
    () => Boolean(globalThis.__mf100demo && globalThis.__mf100router),
    null,
    {
      timeout: 30_000,
    },
  );
  await page.evaluate(async () => {
    await globalThis.__mf100demo.ensureSeeded();
    await globalThis.__mf100demo.signIn("mock-nogiku-creator");
  });
  await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 10_000 });
  await page.evaluate(() => globalThis.__mf100router.navigate({ to: "/works" }));
  const entry = page.locator(".works .mf-table tbody tr", { hasText: "EVE 企画ポスター" });
  await entry.first().waitFor();
  await entry.first().click();
  await page.waitForURL(/\/works\/[^/]+$/);
  await settle();
  await btn("最初の版を提出").click();
  await page.waitForSelector('m3e-dialog[open] input[type="file"]');

  // 縮む PSD 相当（256 KB 以上の繰り返しの多い中身）と、色数の少ない PNG と、PDF 互換の .ai（触らない）
  const psd = Buffer.from("8BPS layer data ".repeat(50_000));
  const png = readFileSync(resolve(FIXTURES, "notation-sample.png"));
  await page.setInputFiles('m3e-dialog[open] input[type="file"]', [
    { name: "big.psd", mimeType: "image/vnd.adobe.photoshop", buffer: psd },
    { name: "notation-sample.png", mimeType: "image/png", buffer: png },
    { name: "poster.ai", mimeType: "", buffer: readFileSync(resolve(FIXTURES, "poster.ai")) },
  ]);
  await page.fill("m3e-dialog[open] textarea >> nth=0", "圧縮の確認");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "アップロードを開始" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".upload-item__state--verified").length >= 3,
    null,
    { timeout: 60_000 },
  );

  const log = await page.evaluate(() => globalThis.__mf100DemoUploads);
  const by = (name) => log.find((u) => u.fileName === name);
  console.log(JSON.stringify(log));
  expectTrue(by("big.psd")?.encoding === "gzip", ".psd が gzip で上がっていない");
  expectTrue(by("big.psd").originalSize === psd.length, ".psd の元の大きさの申告が違う");
  expectTrue(by("big.psd").storedSize < psd.length * 0.1, ".psd が十分に縮んでいない");
  const p = by("notation-sample.png");
  expectTrue(
    p?.encoding === "identity" && p.originalSize < png.length * 0.95,
    `PNG が作り直されていない（${p?.originalSize} / ${png.length}）`,
  );
  expectTrue(
    by("poster.ai")?.encoding === "identity" && by("poster.ai").originalSize === 1388,
    ".ai を触っている",
  );

  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出する" }).click();
  await page.waitForURL(/\/v\/\d+$/, { timeout: 15_000 });
  // 右の引き出しが開いているあいだは縦のツールバーが隠れるので、開いていれば引き出しのタブで、畳んでいれば縦のツールバーで開く
  const bar = page.locator(".ws__side-toolbar");
  if (await bar.isVisible()) await bar.locator('m3e-icon-button[aria-label^="情報"]').click();
  else {
    const tab = page.locator(".drawer .pane-tabs m3e-tab", { hasText: "情報" }).first();
    if ((await tab.getAttribute("selected")) === null) await tab.click();
  }
  await page.waitForSelector('[aria-label="この版のファイル"] m3e-list-item');
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10_000 }),
    page.locator('m3e-icon-button[aria-label="big.psd をダウンロード"]').click(),
  ]);
  expectTrue(download.suggestedFilename() === "big.psd", ".psd が元のファイル名で保存されない");
  const saved = readFileSync(await download.path());
  expectTrue(saved.equals(psd), "ダウンロードした .psd が元のバイト列と違う");
  console.log("OK: png optimised, psd gzip round-trips byte-for-byte");
} catch (e) {
  console.error("FAILED:", e?.message ?? e);
  try {
    console.error("URL:", page.url());
    console.error("TEXT:", (await page.evaluate(() => document.body.innerText)).slice(0, 800));
  } catch {}
  await browser.close();
  process.exit(1);
}
await browser.close();
