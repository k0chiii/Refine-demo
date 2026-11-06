#!/usr/bin/env node
// 読むだけの確認: このデモ版は触ってよい状態か（応答する・デモ版である・デモの操作口がある）。
//   node .claude/skills/verify-mf100-web/scripts/doctor.mjs [BASE_URL]
// 0 で終われば使える。それ以外は理由を 1 行出して 1 で終わる。
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? process.env.BASE_URL ?? "http://127.0.0.1:4173";
const web = fileURLToPath(new URL("../../../../apps/web/", import.meta.url));
const { chromium } = createRequire(web + "package.json")("playwright-core");
const fail = (why) => {
  console.error(`doctor: NG ${base}: ${why}`);
  process.exit(1);
};

const res = await fetch(base + "/").catch((e) => fail(`応答しない（${e.cause?.code ?? e.message}）`));
if (!res.ok) fail(`HTTP ${res.status}`);

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  const page = await browser.newPage();
  await page.goto(base + "/signin");
  const ok = await page
    .waitForFunction(() => Boolean(globalThis.__mf100demo && globalThis.__mf100router), null, {
      timeout: 30_000,
    })
    .then(() => true)
    .catch(() => false);
  if (!ok) fail("デモの操作口（__mf100demo）が無い。--mode demo のビルドではない");
  const users = await page.evaluate(async () => {
    await globalThis.__mf100demo.ensureSeeded();
    return (await globalThis.__mf100demo.users()).map((u) => u.sub);
  });
  if (!users.includes("mock-nogiku-creator")) fail("デモのアカウントが無い");
  console.log(`doctor: OK ${base}（デモ版・アカウント ${users.length} 人）`);
} finally {
  await browser.close();
}
