/**
 * デモモード（バックエンド無し）で主要画面を一周し、docs/screenshots に PNG を保存する。
 *   1) pnpm build:demo && pnpm exec vp preview --mode demo --outDir dist-demo --port 4173
 *   2) BASE_URL=http://127.0.0.1:4173 pnpm screenshots
 * Chromium は PLAYWRIGHT_BROWSERS_PATH（または `npx playwright-core install chromium`）で解決する。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const OUT = process.env.OUT_DIR ?? resolve(here, "../../../docs/screenshots");
const FIXTURES = process.env.FIXTURES_DIR ?? resolve(here, "fixtures");
mkdirSync(OUT, { recursive: true });
/** A11Y=1 で各画面に axe-core（WCAG 2.1 A/AA）を実行し、違反を docs/a11y-report.json に書く（A-15）。 */
const A11Y = process.env.A11Y === "1";
const axeSource = A11Y
  ? readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8")
  : null;
const a11yReport = [];

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

const shot = async (name, scrollTo) => {
  await page.evaluate(async (sel) => {
    window.scrollTo(0, 0);
    if (sel) document.querySelector(sel)?.scrollIntoView({ block: "center" });
    await document.fonts.load('400 24px "Material Symbols Outlined"');
  }, scrollTo ?? null);
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
  console.log("saved", name);
  if (A11Y) {
    await page.evaluate(axeSource);
    const result = await page.evaluate(async () =>
      // eslint-disable-next-line no-undef
      axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      }),
    );
    const violations = result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target, summary: n.failureSummary })),
    }));
    a11yReport.push({ screen: name, violations });
    console.log(
      `  a11y: ${violations.length} violation(s)`,
      violations.map((v) => `${v.id}(${v.impact}×${v.nodes.length})`).join(" "),
    );
  }
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
/** m3e-select（aria-label で特定）に値を入れて change を発火する。 */
const selectValue = async (label, value) => {
  await page.evaluate(
    ([l, v]) => {
      const el = document.querySelector(`m3e-select[aria-label="${l}"]`);
      el.value = v;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [label, value],
  );
  await page.waitForTimeout(100);
};
const btn = (text) => page.locator("m3e-button", { hasText: text }).first();
/** ユーザー選択 UI（UserPicker）で名前を検索して 1 人選ぶ。scope は picker を含む要素の locator。 */
const pickUser = async (scope, name) => {
  const input = scope.locator('input[role="combobox"]').first();
  await input.click();
  await input.fill(name);
  const opt = scope.locator(".picker__option", { hasText: name }).first();
  await opt.click();
  await page.waitForTimeout(200);
};

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
  await page.waitForSelector("text=基本情報");
  await shot("03-work-detail-empty");

  // 04 版提出: ファイル選択 → 転送 → 検証済み → 確定
  await go(`${workUrl}/submit`);
  await page.waitForSelector('input[type="file"]');
  await page.setInputFiles('input[type="file"]', [
    resolve(FIXTURES, "sample.pdf"),
    resolve(FIXTURES, "poster.png"),
    resolve(FIXTURES, "greeting.txt"),
  ]);
  await page.fill("textarea >> nth=0", "初稿。表紙と地図ページ。");
  await page.fill("textarea >> nth=1", "表紙の配色と団体名の表記");
  // 専門確認: 写真（肖像・権利）を校正者に依頼
  const all = await users();
  const reviewer = all.find((u) => u.sub === "mock-nogiku-reviewer");
  await page.locator("m3e-checkbox#check-photo").click();
  await page.waitForSelector(".check:not(.check--done)");
  await pickUser(
    page.locator(".check").filter({ has: page.locator("#check-photo") }),
    reviewer.name,
  );
  await shot("14-submit-required-checks", "fieldset");
  await btn("アップロードを開始").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".upload-item .chip--ok").length >= 3,
    null,
    { timeout: 30_000 },
  );
  await shot("04-submit-verified");
  await btn("提出を確定する").click();
  await page.waitForSelector("text=を提出確定しました");
  await shot("05-submit-confirmed");

  // 06 校正者を割当（主管）: ユーザー選択 UI
  await signInAs("mock-nogiku-manager");
  await go(workUrl);
  await page.waitForSelector("text=版履歴");
  await btn("校正者を割当").click();
  await page.waitForSelector('m3e-dialog[open] input[role="combobox"]');
  await pickUser(page.locator("m3e-dialog[open]"), reviewer.name);
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "割り当てる" }).click();
  await page.waitForTimeout(500);
  await shot("06-work-detail-with-revision");

  // 15 制作物の編集（主管）
  await go(`${workUrl}/edit`);
  await page.waitForSelector("text=制作物を編集");
  await page.waitForSelector("m3e-input-chip");
  await shot("15-work-edit");

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
  await selectValue("重大度", "critical");
  await page.fill(
    'textarea[aria-label="指摘本文"]',
    "団体名の表記が「五月祭常任委員会」ではなく「五月祭実行委員会」になっています。全ページ要確認。",
  );
  await btn("投稿").click();
  await page.waitForSelector(".thread");
  // 2 件目（軽微・位置なし）は未対応のまま残し、次版への持越候補にする
  await selectValue("重大度", "minor");
  await page.fill(
    'textarea[aria-label="指摘本文"]',
    "地図ページの凡例の文字が小さく、印刷時に読めない可能性があります。",
  );
  await btn("投稿").click();
  await page.waitForFunction(() => document.querySelectorAll(".thread").length >= 2);
  await page.locator(".thread").first().click();
  await shot("08-workspace-comment");
  // 専門確認を完了（担当の校正者）
  await page.locator('[aria-label="専門確認"] m3e-button', { hasText: "確認完了" }).click();
  await page.waitForSelector("text=すべて完了");
  await shot("16-required-check-done");

  // 19 文章の範囲指摘（F-12 前倒し分）: 本文を選択して指摘
  await page.locator("m3e-filter-chip", { hasText: "greeting.txt" }).click();
  await page.waitForSelector(".text-viewer__body");
  await page.locator('m3e-icon-button[aria-label="位置を指定"]').click();
  await page.evaluate(() => {
    const body = document.querySelector(".text-viewer__body");
    const needle = "歴代の委員や参加団体の皆さま";
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.textContent.indexOf(needle);
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + needle.length);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        break;
      }
    }
    body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.waitForSelector("text=範囲を指定済み");
  await selectValue("重大度", "major");
  await page.fill(
    'textarea[aria-label="指摘本文"]',
    "「皆さま」が同一段落で 3 回続くので、ここは「各位」に言い換えるか文を分けてください。",
  );
  await btn("投稿").click();
  await page.waitForSelector(".text-anchor");
  await page.locator(".thread").last().click();
  await shot("19-text-range");
  await page.locator("m3e-filter-chip", { hasText: "sample.pdf" }).click();

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

  // 17 第 2 版を提出し、前版の未解決指摘を持ち越す（制作者）
  await go(`${workUrl}/submit`);
  await page.waitForSelector('input[type="file"]');
  await page.setInputFiles('input[type="file"]', [resolve(FIXTURES, "sample.pdf")]);
  await page.fill("textarea >> nth=0", "団体名表記は規約どおり維持。凡例の文字サイズを調整。");
  await btn("アップロードを開始").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".upload-item .chip--ok").length >= 1,
    null,
    { timeout: 30_000 },
  );
  await btn("提出を確定する").click();
  await page.waitForSelector("text=を提出確定しました");
  await btn("校正ワークスペースを開く").click();
  await page.waitForURL(/\/revisions\//);
  await page.waitForSelector('[aria-label="前版の未解決指摘"]');
  await shot("17-carry-forward");
  await page
    .locator('[aria-label="前版の未解決指摘"] m3e-button', { hasText: "この版へ引き継ぐ" })
    .first()
    .click();
  await page.waitForSelector("text=前版から持越");

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

  // 18 通知（校正者）: 依頼・割当・校了などのアプリ内通知
  await signInAs("mock-nogiku-reviewer");
  await go(`${BASE}/notifications`);
  await page.waitForSelector(".notification");
  await shot("18-notifications");

  // 12 閲覧権限（管理者）と管理画面
  await signInAs("mock-nogiku-admin");
  await go(`${workUrl}/acl`);
  await page.waitForSelector("text=有効な許可");
  await shot("12-acl");
  await go(`${BASE}/admin`);
  await page.waitForSelector("text=監査ログ");
  await shot("13-admin-audit");

  // 20 ダークモード（scheme=auto: OS 設定に追従。色はすべて M3 トークン由来）
  await signInAs("mock-nogiku-reviewer");
  await page.emulateMedia({ colorScheme: "dark" });
  await go(revisionUrl);
  await page.waitForSelector(".thread");
  await page.waitForSelector(".viewer__page canvas", { timeout: 30_000 });
  await page.locator(".thread").first().click();
  await shot("20-dark-workspace");
  await page.emulateMedia({ colorScheme: "light" });

  // 21 モバイル幅（下部ナビゲーションバー）
  await page.setViewportSize({ width: 412, height: 915 });
  await go(`${BASE}/queue`);
  await page.waitForSelector("m3e-nav-bar");
  await page.waitForTimeout(400);
  await shot("21-mobile-queue");
  await page.setViewportSize({ width: 1440, height: 900 });
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
if (A11Y) {
  const path = resolve(OUT, "../a11y-report.json");
  writeFileSync(path, JSON.stringify(a11yReport, null, 2));
  console.log("a11y report ->", path);
}
console.log("done ->", OUT);
