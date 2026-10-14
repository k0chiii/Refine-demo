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
  await page.evaluate(
    (p) => {
      const [to, q] = p.split("?");
      const search = q ? Object.fromEntries(new URLSearchParams(q)) : undefined;
      return globalThis.__mf100router.navigate(search ? { to, search } : { to });
    },
    path.replace(BASE, ""),
  );
  await page.waitForTimeout(800);
};

// サインイン画面の「ログイン済みならダッシュボードへ」の効果と競合しないよう、/signin に戻ってからサインインし /queue 到達を待つ
const signInAs = async (sub) => {
  await page.evaluate(() => globalThis.__mf100demo.signOut());
  await go("/signin");
  await page.evaluate(async (s) => {
    await globalThis.__mf100demo.ensureSeeded();
    await globalThis.__mf100demo.signIn(s);
  }, sub);
  await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 10_000 });
  await page.waitForTimeout(300);
};
const users = async () => page.evaluate(() => globalThis.__mf100demo.users());
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

/** PDF の最初のページが描かれるまで待つ（連続表示では canvas は先に置かれ、画面の近くに来てから描かれる） */
const pdfReady = () =>
  page.waitForFunction(
    () => (document.querySelector(".viewer__page canvas")?.width ?? 0) > 0,
    null,
    { timeout: 30_000 },
  );
/** 添付の切替（下部ツールバーの添付ボタン → メニュー） */
const pickArtifact = async (name) => {
  await page.locator('m3e-icon-button[aria-label="添付を切り替え"]').click();
  await page.locator("#artifact-menu m3e-menu-item:visible", { hasText: name }).first().click();
  await page.waitForTimeout(400);
};
/** ビューア上でドラッグ（範囲指定）→ その場の投稿欄に本文を入れて投稿 */
const commentOnRect = async (x0, y0, x1, y1, body) => {
  const overlay = page.locator(".viewer__overlay").first();
  const box = await overlay.boundingBox();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector(".compose-pop textarea");
  await page.fill(".compose-pop textarea", body);
  await page.locator(".compose-pop m3e-button", { hasText: "投稿" }).click();
  await page.waitForSelector(".compose-pop", { state: "detached" });
};
/** 版提出ダイアログを開いてファイルを置き、転送と検証が終わるまで待つ */
const submitRevision = async (buttonText, files, summary, beforeStart) => {
  await btn(buttonText).click();
  await page.waitForSelector('m3e-dialog[open] input[type="file"]');
  await page.setInputFiles('m3e-dialog[open] input[type="file"]', files);
  await page.fill("m3e-dialog[open] textarea >> nth=0", summary);
  if (beforeStart) await beforeStart();
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "アップロードを開始" }).click();
  await page.waitForFunction(
    (n) => document.querySelectorAll(".upload-item__state--verified").length >= n,
    files.length,
    { timeout: 30_000 },
  );
};
/** レール上部のメニュー（展開レールの開閉） */
const railToggle = page.locator('m3e-nav-rail m3e-icon-button[aria-label^="メニュー"]');
/** エディタの引き出し（コメント／版／情報）を縦ツールバーから開く */
const drawer = async (label) => {
  const b = page.locator(`.ws__side-toolbar m3e-icon-button[aria-label^="${label}"]`);
  if ((await b.getAttribute("selected")) === null) await b.click();
  await page.waitForSelector(".drawer__body");
  await page.waitForTimeout(300);
};

async function main() {
  // 01 サインイン
  await page.goto(`${BASE}/signin`);
  await ready();
  await page.locator(`m3e-expansion-panel [slot="header"]`).first().click();
  await shot("01-signin");

  // 02 制作物（制作者）: 探して開くだけの一覧
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/works`);
  await page.waitForSelector("m3e-list-action");
  await shot("02-works-list");
  // 22 アカウントメニュー（右上のアバター）
  await page.locator('m3e-icon-button[aria-label^="アカウント"]').click();
  await page.waitForTimeout(500);
  await shot("22-account-menu");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // 31 レールの FAB「制作物を登録」→ 登録ダイアログ（一覧には登録ボタンを置かない）
  await page.locator("m3e-nav-rail m3e-fab").click();
  await page.waitForSelector("m3e-dialog[open] input");
  await page.waitForTimeout(400);
  await shot("31-new-work-fab");
  await page
    .locator('m3e-dialog[open] [slot="actions"] m3e-button', { hasText: "キャンセル" })
    .click();
  await page.waitForURL(/\/works$/);
  await page.waitForTimeout(300);

  // 03 エディタ（版なし）
  await page.locator("m3e-list-action", { hasText: "MF100 公式パンフレット" }).click();
  await page.waitForURL(/\/works\/[^/]+$/);
  const workUrl = page.url();
  await page.waitForSelector(".editor__empty");
  await shot("03-editor-empty");

  // 04 版提出（ダイアログ）: ファイル → 専門確認 → 転送 → 検証済み → 確定
  const all = await users();
  const reviewer = all.find((u) => u.sub === "mock-nogiku-reviewer");
  await submitRevision(
    "最初の版を提出",
    [
      resolve(FIXTURES, "sample.pdf"),
      resolve(FIXTURES, "poster.png"),
      resolve(FIXTURES, "greeting.txt"),
    ],
    "初稿。表紙と地図ページ。",
    async () => {
      await page.fill("m3e-dialog[open] textarea >> nth=1", "表紙の配色と団体名の表記");
      // 21 日付ピッカー（校正期限は日付のみ・0:00 JST）
      await page
        .locator('m3e-dialog[open] m3e-icon-button[aria-label="カレンダーから選ぶ"]')
        .first()
        .click();
      await page.waitForTimeout(600);
      await shot("21-date-picker");
      await page.locator("m3e-datepicker m3e-button", { hasText: "キャンセル" }).click();
      await page.waitForTimeout(300);
      // 専門確認: 写真（肖像・権利）を校正者に依頼
      await page
        .locator('m3e-dialog[open] m3e-expansion-panel.checks-details [slot="header"]')
        .click();
      await page.locator("m3e-checkbox#check-photo").click();
      await page.waitForSelector("m3e-dialog[open] .check:not(.check--done)");
      await pickUser(
        page.locator(".check").filter({ has: page.locator("#check-photo") }),
        reviewer.name,
      );
      await shot("14-submit-required-checks");
    },
  );
  await shot("04-submit-verified");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/1$/, { timeout: 15_000 });
  const revisionUrl = page.url();
  await pdfReady();
  await shot("05-submit-confirmed");

  // 06 校正者を割当（主管）: 引き出し「情報」から
  await signInAs("mock-nogiku-manager");
  await go(workUrl);
  await pdfReady();
  await drawer("情報");
  await btn("校正者を割当").click();
  await page.waitForSelector('m3e-dialog[open] input[role="combobox"]');
  await pickUser(page.locator("m3e-dialog[open]"), reviewer.name);
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "割り当てる" }).click();
  await page.waitForTimeout(500);
  await shot("06-editor-info");

  // 15 制作物の編集（主管）: 引き出し「情報」の「編集」
  await btn("編集").click();
  await page.waitForSelector("m3e-dialog[open] m3e-input-chip");
  await shot("15-work-edit");
  await page
    .locator('m3e-dialog[open] [slot="actions"] m3e-button', { hasText: "キャンセル" })
    .click();
  await page.waitForTimeout(300);

  // 07 ダッシュボード（校正者）: 「校正する」に割当が出る
  await signInAs("mock-nogiku-reviewer");
  await page.waitForSelector("m3e-list-action");
  await shot("07-dashboard-reviewer");
  // 36 RTL（Bidirectionality）: レールは先頭端（右）、アプリバー・バッジ・リストが鏡映
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  await page.waitForTimeout(500);
  await shot("36-rtl-dashboard");
  await page.evaluate(() => {
    document.documentElement.dir = "ltr";
  });
  await page.waitForTimeout(300);
  // 29 large（1200 以上）: メニューで標準の展開レール（220）。内容を押す。状態は保存され、既定は折りたたみ
  await railToggle.click();
  await page.waitForFunction(() => document.querySelector("m3e-nav-rail")?.mode === "expanded");
  await page.waitForTimeout(500);
  await shot("29-rail-expanded");
  await railToggle.click();
  await page.waitForFunction(() => document.querySelector("m3e-nav-rail")?.mode === "compact");
  await page.waitForTimeout(400);

  // 08 エディタ: PDF 上でドラッグするとその場に投稿欄が出る
  await page.locator("m3e-list-action", { hasText: "MF100 公式パンフレット" }).click();
  await page.waitForURL(/\/works\//);
  await pdfReady();
  await page.locator(".viewer__overlay").first().waitFor();
  await page.evaluate(() => localStorage.setItem("mf100.workspace.layout", "panel"));
  await drawer("コメント");
  await commentOnRect(
    0.15,
    0.12,
    0.6,
    0.22,
    "団体名の表記が「五月祭常任委員会」ではなく「五月祭実行委員会」になっています。全ページ要確認。",
  );
  await page.waitForSelector(".thread");
  // 2 件目（位置なし）は未対応のまま残し、次版への持越候補にする
  await page.locator('m3e-icon-button[aria-label="位置なしでコメント"]').click();
  await page.fill(
    ".compose-pop textarea",
    "地図ページの凡例の文字が小さく、印刷時に読めない可能性があります。",
  );
  await page.locator(".compose-pop m3e-button", { hasText: "投稿" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".thread").length >= 2);
  await page.locator(".thread .thread__body").first().click();
  await shot("08-workspace-comment");
  // 35 ドラッグハンドル（Scaffold › Pane expansion & resizing）: スペーサーのハンドルで固定ペインを 412 → 360 にスナップ
  {
    const hb = await page.locator(".ws__handle").boundingBox();
    await page.mouse.move(hb.x + 2, hb.y + 24);
    await page.mouse.down();
    await page.mouse.move(hb.x + 2 + 56, hb.y + 24, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.locator(".ws__handle").hover();
    await page.waitForTimeout(300);
    await shot("35-pane-drag-handle");
    await page.locator(".ws__handle").focus();
    await page.keyboard.press("Home"); // 既定幅に戻す
    await page.mouse.move(700, 400);
    await page.waitForTimeout(300);
  }
  // 23 ピンの高さに並べる（Google ドキュメント式） / 24 ピンだけ（Figma 式）
  await page.locator('m3e-icon-button[aria-label="ピンの高さに並べる"]').click();
  await page.waitForSelector(".gutter .thread");
  await shot("23-layout-aligned");
  await page.locator('m3e-icon-button[aria-label="ピンだけ"]').click();
  await page.waitForSelector(".thread-pop .thread"); // 選択中のスレッドがピンの横に出る
  await shot("24-layout-pins");
  await page.locator('m3e-icon-button[aria-label="横に一覧"]').click();
  await page.waitForSelector(".comments .thread");
  // 16 専門確認を完了（担当の校正者）: 引き出し「情報」
  await drawer("情報");
  await page.locator('[aria-label="専門確認"] m3e-button', { hasText: "確認完了" }).click();
  await page.waitForSelector("text=すべて完了");
  await shot("16-required-check-done");
  await drawer("コメント");

  // 19 文章の範囲指摘（F-12 前倒し分）: 本文を選択するとその場に投稿欄が出る
  await pickArtifact("greeting.txt");
  await page.waitForSelector(".text-viewer__body");
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
  await page.waitForSelector(".compose-pop textarea");
  await page.fill(
    ".compose-pop textarea",
    "「皆さま」が同一段落で 3 回続くので、ここは「各位」に言い換えるか文を分けてください。",
  );
  await page.locator(".compose-pop m3e-button", { hasText: "投稿" }).click();
  await page.waitForSelector(".text-anchor");
  await page.locator(".comments .thread .thread__body").last().click();
  await shot("19-text-range");
  await pickArtifact("sample.pdf");

  // 27 ダッシュボード（制作者）: 「返事をする」に未対応が出る
  await signInAs("mock-nogiku-creator");
  await page.waitForSelector("m3e-list-action");
  await shot("27-dashboard-creator");

  // 09 採否判断（制作者）: ⋮ → 不採用（理由）
  await go(revisionUrl);
  await page.waitForSelector(".comments .thread");
  const first = page.locator(".comments .thread").first();
  await first.locator(".thread__body").click();
  await page.waitForTimeout(300);
  await first.locator('m3e-icon-button[aria-label="その他の操作"]').click();
  await page.waitForTimeout(300);
  await page.locator("m3e-menu-item:visible", { hasText: "不採用" }).click();
  await page.fill(".thread textarea", "正式名称は「五月祭常任委員会」で正しいことを規約で確認済み");
  await page.locator(".thread m3e-button", { hasText: "不採用" }).click();
  await page.waitForSelector("text=不採用:");
  await shot("09-decision");

  // 17 第 2 版を提出（引き出し「版」）し、前版の未解決指摘を持ち越す（制作者）
  await drawer("版");
  await submitRevision(
    "新しい版を提出",
    [resolve(FIXTURES, "sample.pdf")],
    "団体名表記は規約どおり維持。凡例の文字サイズを調整。",
  );
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/2$/, { timeout: 15_000 });
  const revision2Url = page.url();
  await pdfReady();
  await drawer("コメント");
  await page.waitForSelector('[aria-label="前版の未解決指摘"]');
  await shot("17-carry-forward");
  await page
    .locator('[aria-label="前版の未解決指摘"] m3e-button', { hasText: "この版へ引き継ぐ" })
    .first()
    .click();
  await page.waitForSelector("text=前版から持越");
  // 25 版の比較（引き出し「版」の「比較」）
  await drawer("版");
  await shot("28-versions");
  await page
    .locator(".version", { hasText: "第1版" })
    .locator("m3e-button", { hasText: "比較" })
    .click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".compare__pane")].every(
        (p) => (p.querySelector(".viewer__page canvas")?.width ?? 0) > 0,
      ),
    null,
    { timeout: 30_000 },
  );
  await shot("25-compare");
  await page.locator('m3e-icon-button[aria-label="比較を終了"]').click();
  await page.waitForTimeout(300);

  // 38 比較しながら新しい版にコメント（校正者）: 第1版を開いて第2版と比較 → 第2版が右（操作できる側）に入れ替わる
  await signInAs("mock-nogiku-reviewer");
  await go(revision2Url.replace(/\/v\/2$/, "/v/1"));
  await pdfReady();
  await drawer("版");
  await page
    .locator(".version", { hasText: "第2版" })
    .locator("m3e-button", { hasText: "比較" })
    .click();
  await page.waitForURL(/\/v\/2(\?|$)/, { timeout: 15_000 });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".compare__pane")].every(
        (p) => (p.querySelector(".viewer__page canvas")?.width ?? 0) > 0,
      ),
    null,
    { timeout: 30_000 },
  );
  const labels = await page.locator(".compare__label").allInnerTexts();
  if (!labels[0]?.startsWith("第1版") || !labels[1]?.startsWith("第2版"))
    throw new Error(`比較の並びが違う: ${labels.join(" / ")}`);
  {
    const overlay = page.locator(".compare__pane").last().locator(".viewer__overlay").first();
    const box = await overlay.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 8 });
    await page.mouse.up();
    await page.waitForSelector(".compose-pop textarea");
    await page.fill(
      ".compose-pop textarea",
      "第1版より凡例が小さくなっています。8pt 以上に戻してください。",
    );
    await shot("38-compare-comment");
    const pins = () => page.locator(".compare__pane").last().locator(".anchor-pin").count();
    const before = await pins();
    await page.locator(".compose-pop m3e-button", { hasText: "投稿" }).click();
    await page.waitForSelector(".compose-pop", { state: "detached" });
    await page.waitForFunction(
      (n) => document.querySelectorAll(".compare__pane:last-child .anchor-pin").length > n,
      before,
      { timeout: 10_000 },
    );
  }

  // 持ち越したコメントと比較中のコメントを ✓ で反映済みにする（未解決が残ると理由なしでは校了できない。制作者）
  await signInAs("mock-nogiku-creator");
  await go(revision2Url);
  await pdfReady();
  await drawer("コメント");
  for (let i = 0; i < 5; i++) {
    const resolveBtn = page
      .locator('.comments .thread m3e-icon-button[aria-label^="解決"]')
      .first();
    if ((await resolveBtn.count()) === 0) break;
    await page.locator(".comments .thread .thread__body").first().click();
    await resolveBtn.click();
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => document.body.innerText.includes("反映済"));

  // 10 校了ダイアログ（校了権限者）と校了後: 引き出し「情報」
  await signInAs("mock-nogiku-approver");
  await go(workUrl);
  await pdfReady();
  await drawer("情報");
  await btn("校了を宣言").click();
  await page.waitForSelector("m3e-dialog[open]");
  await shot("10-finalize-dialog");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "校了を確定する" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("校了版"), null, {
    timeout: 15_000,
  });
  await shot("11-work-finalized");

  // 18 通知（校正者）: アプリバーのベルのパネル
  await signInAs("mock-nogiku-reviewer");
  await page.locator('.bell m3e-icon-button[aria-label^="通知"]').click();
  await page.waitForSelector("#notif-menu .notif");
  await page.waitForTimeout(400);
  await shot("18-notifications");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 13 管理画面 / 12 閲覧権限（管理者）: 管理画面のダイアログ（管理者は内容を閲覧しない: D3）
  await signInAs("mock-nogiku-admin");
  await go(`${BASE}/admin`);
  await page.waitForSelector("text=監査ログ");
  await shot("13-admin-audit");
  await page.locator("table.table m3e-button", { hasText: "閲覧権限" }).first().click();
  await page.waitForSelector("m3e-dialog[open] .acl");
  await page.waitForTimeout(400);
  await shot("12-acl");
  await page.locator('m3e-dialog[open] [slot="actions"] m3e-button', { hasText: "閉じる" }).click();
  await page.waitForTimeout(300);

  // 30 expanded（840–1199）: 折りたたみレール。メニューを押すとモーダルの展開レールが重なる（スクリム、Esc で閉じる）
  await signInAs("mock-nogiku-reviewer");
  await page.setViewportSize({ width: 1024, height: 800 });
  await go(revision2Url);
  await pdfReady();
  await railToggle.click();
  await page.waitForSelector(".shell__scrim");
  await page.waitForTimeout(600);
  await shot("30-rail-modal");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".shell__scrim", { state: "detached" });

  // 20 compact（<600）: ダッシュボード（下部ナビ 3 件: ダッシュボード・通知・制作物）/ 32 「通知」はボトムシート
  await page.setViewportSize({ width: 412, height: 915 });
  await go(`${BASE}/`);
  await page.waitForSelector("m3e-nav-bar");
  await page.waitForTimeout(400);
  await shot("20-mobile-dashboard");
  await page.locator("m3e-nav-bar m3e-nav-item.shell__bar-notif").click();
  await page.waitForSelector("m3e-bottom-sheet.notif-sheet .notif");
  await page.waitForTimeout(800);
  await shot("32-mobile-notifications");
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.notif-sheet").hide());
  await page.waitForTimeout(600);
  // 33 compact の制作物一覧（リストは端から端まで、題名の左端 16 と揃う）
  await go(`${BASE}/works`);
  await page.waitForSelector("m3e-list-action");
  await shot("33-mobile-works");
  // 26 compact のエディタ: 共通バーは消え、エディタのトップアプリバー。紙面は幅に合わせ、引き出しは覗き見のボトムシート
  await go(revision2Url);
  await pdfReady();
  await page.waitForSelector("m3e-bottom-sheet.ws__sheet"); // 通知のシート（非表示）と区別する
  await page.waitForTimeout(800);
  await shot("26-mobile-workspace");
  // 37 compact の補助的な選択はボトムシート（Breakpoints: compact は Bottom sheet、medium 以上は Menu）。添付が複数ある第1版で
  await go(revisionUrl);
  await pdfReady();
  await page.waitForTimeout(600);
  await page.locator('m3e-icon-button[aria-label="添付を切り替え"]').click();
  await page.waitForSelector("m3e-bottom-sheet.action-sheet .list__item");
  await page.waitForTimeout(700);
  await shot("37-mobile-action-sheet");
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.action-sheet").hide());
  await page.waitForTimeout(600);
  await go(revision2Url);
  await pdfReady();
  await page.waitForTimeout(600);
  // 34 シートを半分まで上げる（タブを押しても上がる）
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.ws__sheet").show(1));
  await page.waitForTimeout(700);
  await shot("34-mobile-sheet-half");
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---------- 文章エディタ（Google ドキュメント相当。docs/EDITOR_RESEARCH.md）
  // 39 書く（制作者）: 版のない制作物の「文章を書く」→ 上端の浮遊ツールバー＋紙面＋補助ペイン「概要」
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/works`);
  await page.waitForSelector("m3e-list-action");
  await page.locator("m3e-list-action", { hasText: "公式サイト トップページ" }).click();
  await page.waitForURL(/\/works\/[^/]+$/);
  const writeWorkUrl = page.url();
  await page.waitForSelector(".editor__empty");
  await btn("文章を書く").click();
  await page.waitForSelector(".doc[contenteditable=true]");
  await page.click(".doc");
  await page.keyboard.type("# 第100回五月祭へようこそ\n");
  await page.keyboard.type("今年のテーマは「百花繚乱」です。");
  await page.keyboard.press("Control+b");
  await page.keyboard.type("入場は無料");
  await page.keyboard.press("Control+b");
  await page.keyboard.type("で、どなたでもご来場いただけます。\n");
  await page.keyboard.type("## 開催概要\n");
  await page.keyboard.type("- 日程: 5月16日（土）・17日（日）\n会場: 東京大学 本郷キャンパス\n\n");
  await page.keyboard.type("## 来場の皆さまへ\n");
  await page.keyboard.type("[ ] 混雑時は係員の指示に従ってください\nごみは各所のごみ箱へ\n\n");
  await page.keyboard.type("五月祭常任委員会");
  await page.waitForFunction(
    () => document.querySelector(".write__status")?.textContent?.includes("保存しました"),
    null,
    { timeout: 15_000 },
  );
  await shot("39-write-editor");
  // 40 段落スタイル（メニューは各スタイルの見た目で並ぶ。ショートカットも表示）
  await page.locator("#wt-style").click();
  await page.waitForTimeout(500);
  await shot("40-write-style-menu");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // 41 検索と置換（Ctrl+H）: 補助ペインで検索しながら編集を続けられる
  await page.click(".doc");
  await page.keyboard.press("Control+h");
  await page.waitForSelector(".find input");
  await page.locator(".find input").first().fill("五月祭");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  await shot("41-write-find");
  // 42 文字カウント（その他メニュー → 文字カウント。入力中に表示も切り替えられる）
  await page.locator("#wt-more").click();
  await page.waitForTimeout(300);
  await page.locator("#wt-more-menu m3e-menu-item", { hasText: "文字カウント" }).click();
  await page.waitForSelector("m3e-dialog[open] .count-table");
  await page.waitForTimeout(300);
  await shot("42-write-word-count");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "完了" }).click();
  await page.waitForTimeout(300);
  // 版として提出 → HTML の版スナップショット（書式付き）が第1版になる
  await page.locator("m3e-button", { hasText: "版として提出" }).click();
  await page.waitForSelector("m3e-dialog[open] textarea");
  await page.fill("m3e-dialog[open] textarea >> nth=0", "トップページの文章 初稿");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "アップロードを開始" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".upload-item__state--verified").length >= 1,
    null,
    { timeout: 30_000 },
  );
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/1(\?|$)/, { timeout: 15_000 });
  // 校正者を割り当てる（主管）
  await signInAs("mock-nogiku-manager");
  await go(writeWorkUrl);
  await page.waitForSelector(".rich-viewer__page .doc");
  await drawer("情報");
  await btn("校正者を割当").click();
  await page.waitForSelector('m3e-dialog[open] input[role="combobox"]');
  await pickUser(page.locator("m3e-dialog[open]"), reviewer.name);
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "割り当てる" }).click();
  await page.waitForTimeout(500);
  // 43 校正（校正者）: 書式付きのまま表示され、文字を選ぶとその場に投稿欄
  await signInAs("mock-nogiku-reviewer");
  await go(writeWorkUrl);
  await page.waitForSelector(".rich-viewer__page .doc");
  await page.evaluate((needle) => {
    const root = document.querySelector(".rich-viewer__page .doc");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
    document
      .querySelector(".rich-viewer__wrap")
      .dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, "百花繚乱");
  await page.waitForSelector(".compose-pop textarea");
  await page.fill(
    ".compose-pop textarea",
    "テーマ名は公式表記「百花繚乱 ―ひゃっかりょうらん―」に合わせ、ふりがなを付けてください。",
  );
  await shot("43-write-review-select");
  await page.locator(".compose-pop m3e-button", { hasText: "投稿" }).click();
  await page.waitForSelector(".rich-viewer__page .text-anchor");
  await page.waitForTimeout(500);
  const quote = await page.locator(".rich-viewer__page .text-anchor").first().innerText();
  if (!quote.includes("百花繚乱")) throw new Error(`範囲指摘の位置がずれている: ${quote}`);
  await shot("44-write-review-comment");
  // 45 指摘を見ながら直す（制作者）: 補助ペイン「指摘」→ 押すと本文の該当箇所を選ぶ
  await signInAs("mock-nogiku-creator");
  await go(`${writeWorkUrl}/write`);
  await page.waitForSelector(".doc[contenteditable=true]");
  await page.locator('.write__side m3e-icon-button[aria-label="指摘"]').click();
  await page.waitForSelector(".refs__item");
  await page.locator(".refs__item").first().click();
  await page.waitForTimeout(400);
  const picked = await page.evaluate(() => getSelection()?.toString() ?? "");
  if (!picked.includes("百花繚乱")) throw new Error(`指摘から本文を選べない: ${picked}`);
  await shot("45-write-refs");
  // 46 compact の文章エディタ: 下端のドッキングツールバー / 47 その他はボトムシート
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(800);
  await page.click(".doc");
  await shot("46-write-compact");
  await page.locator('.write__docked m3e-icon-button[aria-label="その他"]').click();
  await page.waitForTimeout(700);
  await shot("47-write-compact-more");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await v2Scenes();
}

/** 制作物一覧から名前で開き、その URL を返す */
const openWork = async (title) => {
  await go("/works");
  await page.waitForSelector("m3e-list-action");
  await page.locator("m3e-list-action", { hasText: title }).first().click();
  await page.waitForURL(/\/works\/[^/]+$/);
  await page.waitForTimeout(500);
  return new URL(page.url()).pathname;
};
const expectTrue = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** v2: 表記統一・自動校正・版比較・SNS 投稿 */
async function v2Scenes() {
  // 50–52 表記ルール（システム管理者）: 一覧と詳細・試す・提案
  await signInAs("mock-nogiku-admin");
  await go("/notation");
  await page.waitForSelector("m3e-list-action");
  await page.locator("m3e-list-action", { hasText: "いただき" }).click();
  await page.waitForSelector(".notation__detail .rule-editor");
  await shot("50-notation-rules");
  await go("/notation?view=try");
  await page.waitForSelector("m3e-list-item.finding");
  expectTrue((await page.locator("m3e-list-item.finding").count()) >= 3, "試す: 指摘が出ない");
  await shot("51-notation-try");
  await signInAs("mock-nogiku-reviewer");
  await go("/notation");
  await page.waitForSelector("m3e-list-action");
  await btn("追加を提案").click();
  const ed = page.locator(".notation__detail");
  await ed.locator("input").nth(1).fill("ウェブ");
  await ed.locator("textarea").nth(0).fill("Web");
  await ed.locator("textarea").nth(1).fill("ウェッブ");
  await ed.locator("m3e-button", { hasText: "追加を提案" }).click();
  await page.waitForTimeout(600);
  await signInAs("mock-nogiku-admin");
  await go("/notation?view=proposals");
  await page.waitForSelector("m3e-card.proposal");
  await shot("52-notation-proposals");

  // 53 文章エディタの表記の検査（800ms 後に波線、表記パネル）
  await signInAs("mock-nogiku-creator");
  const sitePath = await openWork("公式サイト トップページ");
  await go(`${sitePath}/write`);
  await page.waitForSelector(".doc[contenteditable=true]");
  await page.click(".doc");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("今年の5月祭では、お問合せは受付まで。");
  await page.waitForSelector(".notation-hit", { timeout: 10_000 });
  await page.locator('.write__side m3e-icon-button[aria-label="表記"]').click();
  await page.waitForSelector(".notation-panel m3e-list-item.finding");
  await shot("53-write-notation");

  // 54–55 提出時の自動校正と PDF の版比較（委員会企画 D の制作物。D は A を継承）
  const poster = await openWork("EVE 企画ポスター");
  await submitRevision("最初の版を提出", [resolve(FIXTURES, "compare-v1.pdf")], "初稿");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/1$/, { timeout: 15_000 });
  await pdfReady();
  await drawer("版");
  await submitRevision(
    "新しい版を提出",
    ["compare-v2.pdf", "notation-sample.pdf", "notation-sample.png"].map((f) =>
      resolve(FIXTURES, f),
    ),
    "協賛ページを追加",
  );
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/2$/, { timeout: 15_000 });
  await pdfReady();
  await drawer("コメント");
  await page.waitForFunction(
    () => /表記の指摘 \d+ 件/.test(document.querySelector(".auto-status")?.textContent ?? ""),
    null,
    {
      timeout: 90_000,
    },
  );
  expectTrue((await page.locator(".thread .thread__bot").count()) > 0, "自動校正の指摘が無い");
  await shot("54-auto-proofread");
  await drawer("版");
  await page
    .locator(".version", { hasText: "第1版" })
    .locator("m3e-button", { hasText: "比較" })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".compare-status")?.textContent?.includes("追加 1"),
    null,
    {
      timeout: 30_000,
    },
  );
  await page.waitForTimeout(800);
  await shot("55-compare-pdf");
  void poster;

  // 56–59 SNS 投稿: 編集とプレビュー → 提出 → 校正画面のプレビュー → 校了版の書き出し
  const sns = await openWork("公式 Instagram 開催告知");
  await btn("投稿を作る").click();
  await page.waitForSelector(".post-edit");
  await page.locator("m3e-button-segment", { hasText: "カルーセル" }).click();
  await page.locator(".post-edit input").nth(0).fill("第100回五月祭");
  await page.locator(".post-edit input").nth(1).fill("mayfes_official");
  await page
    .locator(".post-edit textarea")
    .first()
    .fill(
      "第100回五月祭を本郷キャンパスで開催します！\n詳しくは https://example.invalid をご覧ください。\n#五月祭 #MF100",
    );
  await page.setInputFiles('.post-edit input[type="file"]', [
    resolve(FIXTURES, "poster.png"),
    resolve(FIXTURES, "notation-sample.png"),
  ]);
  await page.waitForSelector(".post-image__thumb");
  await page.locator(".post-image input").first().fill("五月祭のポスター");
  await page.waitForTimeout(600);
  await shot("56-sns-editor");
  await page.locator("m3e-button-segment", { hasText: "プロフィール" }).click();
  await page.waitForTimeout(300);
  await shot("57-sns-preview-grid", ".post-preview");
  await btn("版として提出").click();
  await page.waitForSelector("m3e-dialog[open]");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "アップロードを開始" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".upload-item__state--verified").length >= 4,
    null,
    {
      timeout: 30_000,
    },
  );
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/1$/, { timeout: 15_000 });
  await page.waitForSelector(".sp-figure", { timeout: 20_000 });
  await page.waitForTimeout(1500);
  expectTrue(
    (await page.locator(".post-review").innerText()).includes("校了した版だけ"),
    "校了前に書き出せてしまう",
  );
  await shot("58-sns-review");
  await signInAs("mock-nogiku-approver");
  await go(`${sns}/v/1`);
  await page.waitForSelector(".sp-figure", { timeout: 20_000 });
  await drawer("情報");
  await btn("校了を宣言").click();
  await page.waitForSelector("m3e-dialog[open]");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "校了を確定する" }).click();
  await page.waitForSelector('m3e-button:has-text("まとめて ZIP")', { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await shot("59-sns-export");

  // 60 表記ルール（compact）
  await page.setViewportSize({ width: 412, height: 915 });
  await go("/notation");
  await page.waitForSelector("m3e-list-action");
  await shot("60-notation-compact");
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
