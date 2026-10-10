/**
 * デモモード（バックエンド無し）で主要画面を一周し、docs/screenshots に PNG を保存する。
 *   1) pnpm build:demo && pnpm exec vp preview --mode demo --outDir dist-demo --port 4173
 *   2) BASE_URL=http://127.0.0.1:4173 pnpm screenshots
 * Chromium は PLAYWRIGHT_BROWSERS_PATH（または `npx playwright-core install chromium`）で解決する。
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const OUT = process.env.OUT_DIR ?? resolve(here, "../../../docs/screenshots");
const FIXTURES = process.env.FIXTURES_DIR ?? resolve(here, "fixtures");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.error("[console]", m.text());
});

const shot = async (name) => {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.load('400 24px "Material Symbols Outlined"');
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
  console.log("saved", name);
};
const ready = () =>
  page.waitForFunction(() => Boolean(globalThis.__mf100demo && globalThis.__mf100router), null, {
    timeout: 30_000,
  });
// デモのデータはメモリ上にあるため、ページ再読込（page.goto）ではなく SPA 内遷移で移動する
const go = async (path) => {
  await page.evaluate((p) => globalThis.__mf100router.navigate({ to: p }), path.replace(BASE, ""));
  await page.waitForTimeout(800);
};

// サインイン画面の「ログイン済みなら /queue へ」の効果と競合しないよう、/signin に戻ってからサインインし /queue 到達を待つ
const signInAs = async (sub) => {
  await page.evaluate(() => globalThis.__mf100demo.signOut());
  await go("/signin");
  await page.evaluate(async (s) => {
    await globalThis.__mf100demo.ensureSeeded();
    await globalThis.__mf100demo.signIn(s);
  }, sub);
  await page.waitForURL(/\/queue/, { timeout: 10_000 });
  await page.waitForTimeout(300);
};
const users = async () => page.evaluate(() => globalThis.__mf100demo.users());
const btn = (text) => page.locator("m3e-button", { hasText: text }).first();

async function main() {
  // 01 サインイン
  await page.goto(`${BASE}/signin`);
  await ready();
  await page.locator("summary").click();
  await shot("01-signin");

  // 02 制作物一覧（制作者）
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/works`);
  await page.waitForSelector("table.table a");
  await shot("02-works-list");

  // 03 制作物詳細
  await page.locator("table.table a", { hasText: "MF100 公式パンフレット" }).click();
  await page.waitForURL(/\/works\//);
  const workUrl = page.url();
  const workId = workUrl.split("/works/")[1];
  await page.waitForSelector("text=基本情報");
  await shot("03-work-detail-empty");

  // 04 版提出: ファイル選択 → 転送 → 検証済み → 確定
  await go(`${workUrl}/submit`);
  await page.waitForSelector('input[type="file"]');
  await page.setInputFiles('input[type="file"]', [
    resolve(FIXTURES, "sample.pdf"),
    resolve(FIXTURES, "poster.png"),
  ]);
  await page.fill("textarea >> nth=0", "初稿。表紙と地図ページ。");
  await page.fill("textarea >> nth=1", "表紙の配色と団体名の表記");
  await btn("アップロードを開始").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".upload-item .chip--ok").length >= 2,
    null,
    { timeout: 30_000 },
  );
  await shot("04-submit-verified");
  await btn("提出を確定する").click();
  await page.waitForSelector("text=を提出確定しました");
  await shot("05-submit-confirmed");

  // 06 校正者を割当（主管）
  const all = await users();
  const reviewer = all.find((u) => u.sub === "mock-nogiku-reviewer");
  await signInAs("mock-nogiku-manager");
  await go(workUrl);
  await page.waitForSelector("text=版履歴");
  await btn("校正者を割当").click();
  await page.waitForSelector("m3e-dialog[open] input");
  await page.fill("m3e-dialog[open] input", reviewer.id);
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "割り当てる" }).click();
  await page.waitForTimeout(500);
  await shot("06-work-detail-with-revision");

  // 07 校正待ち（校正者）
  await signInAs("mock-nogiku-reviewer");
  await go(`${BASE}/queue`);
  await page.waitForSelector("table.table a");
  await shot("07-queue");

  // 08 校正ワークスペース: PDF 上で範囲指定して重大指摘を投稿
  await page.locator("table.table a", { hasText: "第1版" }).click();
  await page.waitForURL(/\/revisions\//);
  const revisionUrl = page.url();
  await page.waitForSelector(".viewer__page canvas", { timeout: 30_000 });
  await page.waitForSelector(".viewer__overlay");
  await page.locator('m3e-icon-button[aria-label="位置を指定"]').click();
  const overlay = page.locator(".viewer__overlay");
  const box = await overlay.boundingBox();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.22, { steps: 8 });
  await page.mouse.up();
  await page.selectOption('select[aria-label="重大度"]', "critical");
  await page.fill(
    'textarea[aria-label="指摘本文"]',
    "団体名の表記が「五月祭常任委員会」ではなく「五月祭実行委員会」になっています。全ページ要確認。",
  );
  await btn("投稿").click();
  await page.waitForSelector(".thread");
  await page.locator(".thread").first().click();
  await shot("08-workspace-comment");

  // 09 採否判断（制作者）
  await signInAs("mock-nogiku-creator");
  await go(revisionUrl);
  await page.waitForSelector(".thread");
  await page.locator(".thread").first().click();
  await page.locator(".thread m3e-button", { hasText: "不採用" }).click();
  await page.fill(".thread textarea", "正式名称は「五月祭常任委員会」で正しいことを規約で確認済み");
  await page.locator(".thread m3e-button", { hasText: "記録する" }).click();
  await page.waitForSelector("text=判断:");
  await shot("09-decision");

  // 10 校了ダイアログ（校了権限者）と校了後
  await signInAs("mock-nogiku-approver");
  await go(workUrl);
  await page.waitForSelector("text=版履歴");
  await btn("校了を宣言").click();
  await page.waitForSelector("m3e-dialog[open]");
  await shot("10-finalize-dialog");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "校了を確定する" }).click();
  await page.waitForSelector("text=校了履歴");
  await page.waitForFunction(() => document.body.innerText.includes("校了版"), null, {
    timeout: 15_000,
  });
  await shot("11-work-finalized");

  // 12 閲覧権限（管理者）と管理画面
  await signInAs("mock-nogiku-admin");
  await go(`${workUrl}/acl`);
  await page.waitForSelector("text=有効な許可");
  await shot("12-acl");
  await go(`${BASE}/admin`);
  await page.waitForSelector("text=監査ログ");
  await shot("13-admin-audit");
}

try {
  await main();
} catch (e) {
  console.error("FAILED:", e?.message ?? e);
  try {
    console.error("URL:", page.url());
    console.error("TEXT:", (await page.evaluate(() => document.body.innerText)).slice(0, 1500));
    await page.screenshot({ path: resolve(OUT, "zz-failure.png") });
  } catch {}
  await browser.close();
  process.exit(1);
}
await browser.close();
console.log("done ->", OUT);
