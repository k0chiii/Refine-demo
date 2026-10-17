/**
 * 自動校正（表記統一）の試験用ファイルを作る。デモのサンプルルール（五月祭・お問い合わせ・ください・本郷キャンパス 等）に当たる誤表記を含む。
 * - notation-sample.pdf: PDF.js で文字を取り出せる PDF（2 ページ）
 * - notation-sample.png: 文字を画像にしたもの（OCR 用）
 * - notation-sample.txt: 平文
 * - notation-scan.pdf: 文字を画像として貼った PDF（文字の無いページの OCR 用）
 * 実行: node e2e/make-notation-fixtures.mjs
 */
import { chromium } from "playwright-core";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = pathToFileURL(resolve(here, "../node_modules/@fontsource/noto-sans-jp/index.css")).href;
const pages = [
  {
    title: "第100回5月祭のご案内",
    lines: ["今年の5月祭は本郷で開催します。", "ご来場を心よりお待ちして下さい。"],
  },
  {
    title: "お問合せ",
    lines: ["ご不明な点はお問合せ窓口までご連絡下さい。", "ご参加頂きありがとうございます。"],
  },
];
const html = (body, style) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"><style>body{font-family:"Noto Sans JP";margin:0}${style}</style></head><body>${body}</body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
});
const p = await browser.newPage({ viewport: { width: 1200, height: 520 } });
const dir = mkdtempSync(join(tmpdir(), "mf100-notation-"));
const write = async (name, body, style) => {
  const file = join(dir, `${name}.html`);
  writeFileSync(file, html(body, style));
  await p.goto(pathToFileURL(file).href);
  await p.evaluate(() => document.fonts.ready);
};
await write(
  "pdf",
  pages
    .map(
      (pg) =>
        `<section><h1>${pg.title}</h1>${pg.lines.map((l) => `<p>${l}</p>`).join("")}</section>`,
    )
    .join(""),
  "@page{size:A5;margin:16mm} section{page-break-after:always} section:last-child{page-break-after:auto} h1{font-size:20pt} p{font-size:12pt;line-height:1.8}",
);
await p.pdf({
  path: resolve(here, "fixtures", "notation-sample.pdf"),
  format: "A5",
  printBackground: true,
});
await write(
  "png",
  `<div class="sheet">${pages
    .flatMap((pg) => pg.lines)
    .map((l) => `<p>${l}</p>`)
    .join("")}</div>`,
  ".sheet{background:#fff;color:#111;padding:40px 48px} p{font-size:40px;margin:0 0 20px;line-height:1.4}",
);
await p.locator(".sheet").screenshot({ path: resolve(here, "fixtures", "notation-sample.png") });
// スキャンした PDF の代わり: 文字を画像として貼った PDF（PDF.js では文字を取り出せない → OCR に回る）
const png = readFileSync(resolve(here, "fixtures", "notation-sample.png")).toString("base64");
await write(
  "scan",
  `<img src="data:image/png;base64,${png}" style="width:100%">`,
  "@page{size:A5 landscape;margin:8mm}",
);
await p.pdf({
  path: resolve(here, "fixtures", "notation-scan.pdf"),
  format: "A5",
  landscape: true,
});
writeFileSync(
  resolve(here, "fixtures", "notation-sample.txt"),
  pages.flatMap((pg) => [pg.title, ...pg.lines]).join("\n") + "\n",
);
console.log("wrote notation-sample.pdf / .png / .txt");
await browser.close();
