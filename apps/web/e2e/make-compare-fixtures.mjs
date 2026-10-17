/**
 * 版比較の試験用 PDF を作る（旧 5 ページ・新 6 ページ。新版は 3 ページ目に協賛ページを挿入し、4 ページ目の文章を一部変更）。
 * 日本語フォントは @fontsource/noto-sans-jp をそのまま使う。実行: node e2e/make-compare-fixtures.mjs
 */
import { chromium } from "playwright-core";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = pathToFileURL(resolve(here, "../node_modules/@fontsource/noto-sans-jp/index.css")).href;
const page = (title, lines) =>
  `<section><h1>${title}</h1>${lines.map((l) => `<p>${l}</p>`).join("")}</section>`;
const common = [
  page("第100回五月祭 公式パンフレット", [
    "テーマ「百花繚乱」",
    "2026年5月16日・17日 東京大学本郷キャンパス",
    "主催 五月祭常任委員会",
  ]),
  page("ごあいさつ", [
    "第100回五月祭にようこそ。",
    "委員長から来場者の皆さまへのメッセージです。",
    "記念すべき百回目の開催を、皆さまと迎えられることを嬉しく思います。",
  ]),
];
const tail = (changed) => [
  page("企画一覧", [
    "屋内企画・屋外企画・ステージ企画を分類して紹介します。",
    changed ? "参加団体は合計で四百五十団体です。" : "参加団体は合計で四百団体です。",
    "詳細は公式サイトの企画検索をご覧ください。",
  ]),
  page("会場地図", [
    "本郷キャンパスと弥生キャンパスの全体図です。",
    "案内所は正門と赤門の二か所にあります。",
    "救護所は安田講堂の前です。",
  ]),
  page("お問い合わせ", [
    "五月祭常任委員会 広報局",
    "メール info@example.invalid",
    "ご来場ありがとうございました。",
  ]),
];
const sponsor = page("協賛企業のご紹介", [
  "株式会社〇〇様",
  "△△財団様",
  "□□銀行様",
  "ご協賛いただいた皆さまに御礼申し上げます。",
]);
const html = (
  sections,
) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="${css}">
<style>@page{size:A5;margin:16mm} body{font-family:"Noto Sans JP";} section{page-break-after:always} section:last-child{page-break-after:auto}
h1{font-size:20pt;margin:0 0 12mm} p{font-size:11pt;line-height:1.8;margin:0 0 4mm}</style></head><body>${sections.join("")}</body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
});
const p = await browser.newPage();
const dir = mkdtempSync(join(tmpdir(), "mf100-fixture-"));
for (const [name, sections] of [
  ["compare-v1.pdf", [...common, ...tail(false)]],
  ["compare-v2.pdf", [...common, sponsor, ...tail(true)]],
]) {
  const file = join(dir, String(name) + ".html");
  writeFileSync(file, html(sections));
  await p.goto(pathToFileURL(file).href);
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: resolve(here, "fixtures", name), format: "A5", printBackground: true });
  console.log("wrote", name);
}
await browser.close();
