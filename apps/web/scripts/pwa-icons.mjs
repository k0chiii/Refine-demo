/**
 * PWA のアイコンを作る（public/icons/*.png）。手元で一度だけ実行し、出力をコミットする。
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/pwa-icons.mjs
 * 図柄は Material Symbols「edit_document」（白）を M3 のテーマの元色 #1b5fb4 の上に置く。
 * maskable は M3 / Android の adaptive icon の安全域（直径 80%）に収まるよう図柄を小さくする。
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../public/icons");
mkdirSync(out, { recursive: true });
const font = readFileSync(
  resolve(
    here,
    "../node_modules/@fontsource-variable/material-symbols-outlined/files/material-symbols-outlined-latin-full-normal.woff2",
  ),
).toString("base64");

const SEED = "#1b5fb4";
/** name, size, 図柄の大きさ（辺に対する割合）, 角丸（割合。0 は四角＝OS が切り抜く） */
const icons = [
  ["icon-192.png", 192, 0.62, 0.22],
  ["icon-512.png", 512, 0.62, 0.22],
  ["icon-maskable-512.png", 512, 0.5, 0],
  ["apple-touch-icon.png", 180, 0.6, 0],
  ["favicon-32.png", 32, 0.78, 0.22],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
for (const [name, size, glyph, radius] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><style>
    @font-face { font-family: "MS"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 700; }
    html, body { margin: 0; background: transparent; }
    .i { width: ${size}px; height: ${size}px; display: grid; place-items: center; background: ${SEED};
         border-radius: ${radius * 100}%; }
    .g { font-family: "MS"; font-size: ${Math.round(size * glyph)}px; line-height: 1; color: #fff;
         font-variation-settings: "FILL" 1, "wght" 500, "GRAD" 0, "opsz" 48; }
  </style><div class="i"><span class="g">edit_document</span></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(out, name), omitBackground: true });
  console.log("wrote", name);
}
await browser.close();
