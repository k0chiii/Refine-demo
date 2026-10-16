/**
 * デモモード（バックエンド無し）で主要画面を一周し、e2e/out/screenshots に PNG を保存する（git 管理外）。
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
const OUT = process.env.OUT_DIR ?? resolve(here, "out/screenshots");
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
/** 制作物一覧の行（「局 › 担当」の入れ子のリストの項目） */
const WORKS_ENTRY = ".works m3e-list-action";
/** ユーザー選択 UI（UserPicker）で名前を検索して 1 人選ぶ。scope は picker を含む要素の locator。 */
const pickUser = async (scope, name) => {
  const input = scope.locator(".picker__search input").first();
  await input.click();
  await input.fill(name);
  // 候補は M3E autocomplete のメニュー（option ロール）に出る
  await page
    .getByRole("option", { name: new RegExp(name) })
    .first()
    .click();
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

  // 02 制作物一覧（制作者）: 「局 › 担当」の入れ子のリスト（主管担当ごと）。02b は制作担当ごと（同じ制作物が複数の担当の下に出る）
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/works`);
  await page.waitForSelector(".works-team-list__bureau");
  await shot("02-works-list");
  const siteRows = () => page.locator(WORKS_ENTRY, { hasText: "公式サイト トップページ" }).count();
  expectTrue((await siteRows()) === 1, "主管担当ごとの一覧で、制作物が 1 か所にない");
  await page.locator(".works__axis m3e-button", { hasText: "制作担当" }).click();
  await page.waitForURL(/by=production/);
  await page.waitForTimeout(400);
  expectTrue(
    (await siteRows()) === 2,
    "制作担当ごとの一覧で、制作担当 2 つの制作物が 2 か所に出ない",
  );
  await shot("02b-works-production");
  await page.locator(".works__axis m3e-button", { hasText: "主管担当" }).click();
  // 22 アカウントメニュー（右上のアバター）
  await page.locator('m3e-icon-button[aria-label^="アカウント"]').click();
  await page.waitForTimeout(500);
  await shot("22-account-menu");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // 31b レールの FAB「版を提出」→ 版を提出する制作物を選ぶ（自分が制作者の進行中の制作物を納期順。§36 L-15）
  await page.locator('m3e-nav-rail m3e-fab[aria-label="版を提出"]').click();
  await page.waitForSelector("m3e-dialog.submit-picker[open] m3e-list-action");
  await page.waitForTimeout(400);
  await shot("31b-submit-picker");
  await page
    .locator('m3e-dialog.submit-picker[open] [slot="actions"] m3e-button', {
      hasText: "キャンセル",
    })
    .click();
  await page.waitForSelector("m3e-dialog.submit-picker[open]", { state: "detached" });
  await page.waitForTimeout(300);
  // 31 制作物の登録は登録権限のある人だけ、制作物の一覧のアプリバーの操作から（FAB は「版を提出」に譲った）
  await page.locator('.shell__appbar m3e-icon-button[aria-label="制作物を登録"]').click();
  await page.waitForSelector("m3e-dialog[open] input");
  await page.waitForTimeout(400);
  await shot("31-new-work");
  await page
    .locator('m3e-dialog[open] [slot="actions"] m3e-button', { hasText: "キャンセル" })
    .click();
  await page.waitForURL(/\/works$/);
  await page.waitForTimeout(300);

  // 03 エディタ（版なし）
  await page.locator(WORKS_ENTRY, { hasText: "MF100 公式パンフレット" }).first().click();
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
      // 21 日付ピッカー（校正期限は日付と任意の時刻。日付だけならその日の 23:59 まで）
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

  // 06 校正者を割り当てる（主管）: 引き出し「情報」から
  await signInAs("mock-nogiku-manager");
  await go(workUrl);
  await pdfReady();
  await drawer("情報");
  await btn("校正者を割り当てる").click();
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

  // 07 ダッシュボード（校正者）: 「校正する」に割り当てが出る
  await signInAs("mock-nogiku-reviewer");
  await page.waitForSelector("m3e-list-action");
  await shot("07-dashboard-reviewer");
  // （36 RTL は外した。日本語だけのアプリなので RTL には対応しない。利用者決定 2026-10-15・UI_M3E §35 L-16）
  // 29 large（1200 以上）: メニューで標準の展開レール（220）。内容を押す。状態は保存され、既定は折りたたみ
  await railToggle.click();
  await page.waitForFunction(() => document.querySelector("m3e-nav-rail")?.mode === "expanded");
  await page.waitForTimeout(500);
  await shot("29-rail-expanded");
  await railToggle.click();
  await page.waitForFunction(() => document.querySelector("m3e-nav-rail")?.mode === "compact");
  await page.waitForTimeout(400);

  // 08 エディタ: PDF 上でドラッグするとその場に投稿欄が出る（ダッシュボードの「校正する」の行から。同じ制作物は「次の締切」にも出る）
  await page.locator("m3e-list-action", { hasText: "MF100 公式パンフレット" }).first().click();
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
  // 2 件目（位置なし）は未対応のまま残し、次版への持ち越し候補にする
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
  await page.locator('[aria-label="専門確認"] m3e-button', { hasText: "確認を完了" }).click();
  await page.waitForSelector("text=すべて完了");
  await shot("16-required-check-done");
  await drawer("コメント");

  // 19 文章の範囲へのコメント（F-12 前倒し分）: 本文を選択するとその場に投稿欄が出る
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
  // 「@」で制作物を見られる人をメンション（候補から選ぶ）
  await page.fill(".compose-pop textarea", "@五月");
  await page.locator(".mention-list m3e-list-action", { hasText: "五月 めい" }).click();
  await page.locator(".compose-pop textarea").press("End");
  await page.keyboard.type(
    "「皆さま」が同一段落で 3 回続くので、ここは「各位」に言い換えるか文を分けてください。",
  );
  await page.locator(".compose-pop m3e-button", { hasText: "投稿" }).click();
  await page.waitForSelector(".text-anchor");
  await page.waitForSelector(".thread__body .mention");
  await page.locator(".comments .thread .thread__body").last().click();
  await shot("19-text-range");
  await pickArtifact("sample.pdf");

  // 27 ダッシュボード（制作者）: 「提出する」（各行に「版を提出」）・「返事をする」に未対応が出る。広い画面は 2 列（左がやること）
  await signInAs("mock-nogiku-creator");
  await page.waitForSelector("m3e-list-action");
  await shot("27-dashboard-creator");
  // 61 ホームを編集（全画面のダイアログ。節ごとのスイッチと上下のボタン。§36 W-26）
  await page.locator('.shell__appbar m3e-icon-button[aria-label="ホームを編集"]').click();
  await page.waitForSelector("m3e-dialog.home-edit[open] m3e-switch");
  await page.waitForTimeout(500);
  await shot("61-home-edit");
  await page
    .locator('m3e-dialog.home-edit[open] [slot="actions"] m3e-button', { hasText: "キャンセル" })
    .click();
  await page.waitForSelector("m3e-dialog.home-edit[open]", { state: "detached" });
  await page.waitForTimeout(300);

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

  // 17 第 2 版を提出（引き出し「版」）し、前版の未解決コメントを持ち越す（制作者）
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
  await page.waitForSelector('[aria-label="前版の未解決コメント"]');
  await shot("17-carry-forward");
  await page
    .locator('[aria-label="前版の未解決コメント"] m3e-button', { hasText: "この版へ持ち越す" })
    .first()
    .click();
  await page.waitForSelector("text=前版から持ち越し");
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
  // ズームでの視点の同期: 拡大して右をスクロールしても、左右の舞台の中央に紙面の同じ箇所（ページ内の縦・横の割合）が来る
  for (let i = 0; i < 2; i++) {
    await page.locator('m3e-icon-button[aria-label="拡大"]').click();
    await page.waitForTimeout(300);
  }
  await page.evaluate(() =>
    [...document.querySelectorAll(".compare__pane .viewer__stage")].at(-1).scrollBy(120, 240),
  );
  await page.waitForTimeout(500);
  const views = await page.evaluate(() =>
    [...document.querySelectorAll(".compare__pane .viewer__stage")].map((s) => {
      const sr = s.getBoundingClientRect();
      const x = sr.left + s.clientWidth / 2;
      const y = sr.top + s.clientHeight / 2;
      const pages = [...s.querySelectorAll(".viewer__page")];
      const i = Math.max(
        0,
        pages.findIndex((p) => p.getBoundingClientRect().bottom > y),
      );
      const r = pages[i].getBoundingClientRect();
      return { page: i, rx: (x - r.left) / r.width, ry: (y - r.top) / r.height };
    }),
  );
  expectTrue(
    views.length === 2 &&
      views[0].page === views[1].page &&
      Math.abs(views[0].rx - views[1].rx) < 0.02 &&
      Math.abs(views[0].ry - views[1].ry) < 0.02,
    `拡大・スクロール後に左右の視点がずれている: ${JSON.stringify(views)}`,
  );
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
  const adminWorks = 'm3e-action-list[aria-label="制作物ごとの閲覧権限"] m3e-list-action';
  await page.waitForSelector(adminWorks);
  await shot("13-admin-works");
  await page.locator(adminWorks).first().click();
  await page.waitForSelector("m3e-dialog[open] .acl");
  await page.waitForTimeout(400);
  await shot("12-acl");
  await page.locator('m3e-dialog[open] [slot="actions"] m3e-button', { hasText: "閉じる" }).click();
  await page.waitForTimeout(300);
  // 13a・13b 管理のタブ（ユーザー・監査ログ）
  await page.locator("m3e-tab", { hasText: "ユーザー" }).click();
  await page.waitForSelector('m3e-list[aria-label="ユーザー"] m3e-switch');
  await shot("13a-admin-users");
  await page.locator("m3e-tab", { hasText: "監査ログ" }).click();
  await page.waitForSelector('m3e-list[aria-label="監査ログ"] .mono');
  await shot("13b-admin-audit");
  // 13c SNS アカウント（本体の設定）: リストの行を押すとダイアログで直す。制作物ごとにどれを使うか割り当てる
  await page.locator("m3e-tab", { hasText: "SNS アカウント" }).click();
  await page.waitForSelector('m3e-action-list[aria-label="SNS アカウント"] m3e-list-action');
  await shot("13c-admin-sns");
  // 13d 担当（局 › 担当）: 局ごとのリスト。各行の ⋮ から追加・名前・並べ替え・削除
  await page.locator("m3e-tab", { hasText: "担当" }).click();
  await page.waitForSelector(".teams-admin__team");
  await shot("13d-admin-teams");
  // 62・63 フィードバック（制作物ごとの FB スペース。委員なら誰でも見て書ける）: スペースの一覧 → スペース（紙面・スレッド）→
  // スレッド → テンプレと画像を付けて返信 → リアクション
  await page.locator("m3e-nav-item", { hasText: "フィードバック" }).first().click();
  await page.waitForSelector(".fb-spaces__list m3e-list-action");
  await shot("62-feedback-list");
  await page.locator(".fb-spaces__list m3e-list-action", { hasText: "EVE 企画ポスター" }).click();
  await page.locator(".fb-pane__list m3e-list-action", { hasText: "配色の方向性" }).click();
  await page.waitForSelector(".fb-post");
  const before = await page.locator(".fb-post").count();
  await page.locator('.fb-composer m3e-icon-button[aria-label="テンプレート"]').click();
  await page.locator("m3e-menu-item:visible", { hasText: "校正er" }).click();
  await page.setInputFiles('.fb-composer input[type="file"]', [resolve(FIXTURES, "poster.png")]);
  await page.locator('.fb-composer m3e-icon-button[aria-label="送信"]').click();
  await page.waitForFunction((n) => document.querySelectorAll(".fb-post").length > n, before, {
    timeout: 20_000,
  });
  await page.waitForSelector(".fb-post:last-of-type .fb-thumb img");
  // 投稿の操作はマウスを乗せたときに出る（Slack の操作バー）。投稿の頭を見える位置に送ってから
  await page
    .locator(".fb-post")
    .last()
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page
    .locator(".fb-post")
    .last()
    .hover({ position: { x: 40, y: 20 } });
  await page
    .locator(".fb-post")
    .last()
    .locator('m3e-icon-button[aria-label="リアクションを付ける"]')
    .click();
  await page.locator("m3e-menu-item:visible", { hasText: "👍" }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".fb-post")]
      .at(-1)
      ?.querySelector(".fb-post__reactions m3e-filter-chip[selected]"),
  );
  await shot("63-feedback-thread");
  // 64 制作物の中の FB（相談。解決しない話し合い）: 紙面の範囲を選び「FB」に切り替えて立てる →
  // 引き出し「FB」でそのやり取りが開き、紙面には四角い印（コメントの丸い印と見分ける）
  await signInAs("mock-nogiku-reviewer");
  await go(revisionUrl);
  await pdfReady();
  await page.waitForTimeout(500);
  {
    const box = await page.locator(".viewer__overlay").first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.4, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForSelector(".compose-pop textarea");
  const fbSegment = page.locator(".compose-pop__kind m3e-button", { hasText: "FB" });
  if (await fbSegment.count()) await fbSegment.click();
  await page.fill(".compose-pop textarea", "ここの余白、もう少し詰めても良さそう？ 迷っています");
  await page.locator(".compose-pop m3e-button", { hasText: "FB で相談" }).click();
  await page.waitForSelector(".fb-pane--thread .fb-post");
  await page.waitForSelector(".anchor-pin--fb");
  await shot("64-editor-fb");
  // 64b FB スペース（縦に 3 列: スペース・紙面・スレッド）。紙面の FB の印から、そのスレッドを開いて話す
  {
    const workId = new URL(revisionUrl).pathname.split("/")[2];
    await go(`${BASE}/feedback/w/${workId}`);
    await pdfReady();
    // 紙面は最新の版（第2版）。第1版の範囲についての FB を開くと、紙面がその版・場所へ移り印が出る
    await page.locator(".fb-pane__list m3e-list-action", { hasText: "余白" }).click();
    await page.waitForSelector(".fb-space__threads .fb-pane--thread .fb-post");
    await page.waitForSelector(".fb-stage .anchor-pin--fb");
    await shot("64b-feedback-space");
  }

  // 30 expanded（840–1199）: 折りたたみレール。メニューを押すとモーダルの展開レールが重なる（スクリム、Esc で閉じる）。
  // 制作物を開いた画面（下の階層）ではレールを隠すので、一覧で確かめる
  await signInAs("mock-nogiku-reviewer");
  await page.setViewportSize({ width: 1024, height: 800 });
  await go(revision2Url);
  await pdfReady();
  expectTrue(
    await page.locator(".shell__nav").evaluate((el) => el.hidden),
    "制作物を開いた画面でレールが隠れていない",
  );
  await go(`${BASE}/works`);
  await page.waitForSelector(WORKS_ENTRY);
  await railToggle.click();
  await page.waitForSelector(".shell__scrim");
  await page.waitForTimeout(600);
  await shot("30-rail-modal");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".shell__scrim", { state: "detached" });

  // 20 compact（<600）: ダッシュボード（1 列のリスト。下部ナビ: ダッシュボード・制作物・エディタ・表記ルール）。
  // 制作者で撮り、右下（下部ナビの上 16）の FAB「版を提出」も写す / 32 アプリバーのベル（アカウントの隣）→ ボトムシート
  await page.setViewportSize({ width: 412, height: 915 });
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/`);
  await page.waitForSelector("m3e-nav-bar");
  await page.waitForSelector(".submit-fab m3e-fab");
  await page.waitForTimeout(400);
  await shot("20-mobile-dashboard");
  await page.locator(".shell__appbar .bell m3e-icon-button").click();
  await page.waitForSelector("m3e-bottom-sheet.notif-sheet .notif");
  await page.waitForTimeout(800);
  await shot("32-mobile-notifications");
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.notif-sheet").hide());
  await page.waitForTimeout(600);
  // 33 compact の制作物一覧（リストは端から端まで、題名の左端 16 と揃う。右下に FAB「版を提出」）
  await go(`${BASE}/works`);
  await page.waitForSelector("m3e-list-action");
  await shot("33-mobile-works");
  await signInAs("mock-nogiku-reviewer");
  // 26 compact のエディタ: 共通バーは消え、エディタのトップアプリバー。紙面は画面いっぱいで、引き出し（コメント・版・情報）はツールバーから開くボトムシート
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
  // 34 引き出しは普段は閉じていて、ツールバーの「コメント」で半分まで開く
  await page.locator('.ws__toolbar m3e-icon-button[aria-label^="コメント"]').click();
  await page.waitForTimeout(700);
  expectTrue(
    await page.evaluate(() => document.querySelector("m3e-bottom-sheet.ws__sheet").open),
    "ツールバーのコメントでシートが開かない",
  );
  // ハンドルと止まる高さが付いている（属性が無いとハンドルが出ず、上下に動かせない）
  expectTrue(
    await page.evaluate(() => {
      const s = document.querySelector("m3e-bottom-sheet.ws__sheet");
      return s.hasAttribute("handle") && s.getAttribute("detents") === "half full";
    }),
    "引き出しのシートにハンドル・止まる高さが無い",
  );
  await shot("34-mobile-sheet-half");
  // 65 狭い画面の FB: シートのタブで「FB」に切り替える（制作物の相談の一覧）
  await page.locator("m3e-bottom-sheet.ws__sheet m3e-tab", { hasText: "FB" }).click();
  await page.waitForSelector("m3e-bottom-sheet.ws__sheet .fb-pane");
  await page.waitForTimeout(500);
  await shot("65-mobile-editor-fb");
  // 開いている間はシートがツールバーに重なる（中のタブで切り替え、下に払うと閉じる）
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.ws__sheet").hide());
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---------- 文章エディタ（Google ドキュメント相当。docs/EDITOR_RESEARCH.md）
  // 39 書く（制作者）: 版のない制作物の「文章を書く」→ 上端の浮遊ツールバー＋紙面＋補助ペイン「概要」
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/works`);
  await page.waitForSelector(WORKS_ENTRY);
  await page.locator(WORKS_ENTRY, { hasText: "公式サイト トップページ" }).first().click();
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
  // 39a サイドレールの「エディタ」: 書ける担当の制作物を選ぶ（最近書いた下書きが上）→ 選ぶとエディタへ
  await page.locator('m3e-nav-item[data-to="/write"]').first().click();
  await page.waitForURL(/\/write$/);
  await page.waitForSelector(".write-picker m3e-list-action");
  const firstPick = await page.locator(".write-picker m3e-list-action").first().innerText();
  expectTrue(
    firstPick.includes("公式サイト トップページ") && firstPick.includes("下書き"),
    `エディタの入口: 最近書いた下書きが上に出ない（${firstPick}）`,
  );
  await shot("39a-write-picker");
  await page.locator(".write-picker m3e-list-action").first().click();
  await page.waitForSelector(".doc[contenteditable=true]");
  expectTrue(
    await page.evaluate(
      () => document.querySelector('m3e-nav-item[data-to="/write"]')?.selected === true,
    ),
    "エディタを開いているのにレールの「エディタ」が選択されていない",
  );
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
  await page.waitForSelector("m3e-dialog[open] .count-list");
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
  await btn("校正者を割り当てる").click();
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
  if (!quote.includes("百花繚乱")) throw new Error(`範囲へのコメントの位置がずれている: ${quote}`);
  await shot("44-write-review-comment");
  // 44a スマホ（指の操作）: 文字を選ぶと「選んだ文字にコメント」ボタン → 投稿欄は画面下に全幅（引用つき）
  await page.evaluate(() => {
    const orig = window.matchMedia.bind(window);
    window.__origMatchMedia = orig;
    window.matchMedia = (q) =>
      q.includes("pointer: coarse")
        ? {
            matches: true,
            media: q,
            addEventListener() {},
            removeEventListener() {},
            onchange: null,
          }
        : orig(q);
  });
  await page.setViewportSize({ width: 412, height: 915 });
  // 同じ URL だと画面が作り直されず、差し替えた matchMedia を読まないので、一度離れてから開く
  await go("/");
  await go(writeWorkUrl);
  await page.waitForSelector(".rich-viewer__page .doc");
  await page.waitForTimeout(600);
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
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        break;
      }
    }
  }, "入場は無料");
  await page.waitForSelector(".touch-comment", { timeout: 5000 });
  expectTrue(
    (await page.locator(".compose-pop").count()) === 0,
    "指の操作で選んだ瞬間に投稿欄が出た",
  );
  await page.locator(".touch-comment").click();
  await page.waitForSelector(".compose-pop--docked .compose-pop__quote");
  expectTrue(
    (await page.locator(".compose-pop__quote").innerText()).includes("入場は無料"),
    "投稿欄に選んだ文字の引用が出ない",
  );
  await shot("44a-mobile-text-comment");
  await page.locator('.compose-pop m3e-icon-button[aria-label="キャンセル"]').click();
  await page.evaluate(() => {
    window.matchMedia = window.__origMatchMedia;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  // 45 コメントを見ながら直す（制作者）: 補助ペイン「コメント」→ 押すと本文の該当箇所を選ぶ
  await signInAs("mock-nogiku-creator");
  await go(`${writeWorkUrl}/write`);
  await page.waitForSelector(".doc[contenteditable=true]");
  await page.locator('.write__side m3e-icon-button[aria-label="コメント"]').click();
  await page.waitForSelector(".refs__item");
  await page.locator(".refs__item").first().click();
  await page.waitForTimeout(400);
  const picked = await page.evaluate(() => getSelection()?.toString() ?? "");
  if (!picked.includes("百花繚乱")) throw new Error(`コメントから本文を選べない: ${picked}`);
  await shot("45-write-refs");
  // 46 compact の文章エディタ: 画面下に浮かぶ vibrant のツールバー
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(800);
  await page.click(".doc");
  await shot("46-write-compact");
  // 46a 丸いボタン（文字の書式）で 2 本目のツールバーが伸びる。押しても本文のフォーカスは外れない
  await page.locator('.mfb__bar m3e-icon-button[aria-label="文字の書式"]').click();
  await page.waitForSelector(".mfb__panel--text");
  await page.waitForTimeout(500);
  expectTrue(
    await page.evaluate(() => document.activeElement?.closest(".doc") !== null),
    "丸いボタンで本文のフォーカスが外れた",
  );
  await shot("46a-write-compact-expand");
  // 46b キーボードが出たとき（visual viewport を 336px 縮めて再現）: ツールバーがキーボードのすぐ上へ
  await page.evaluate(() => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, "height", {
      configurable: true,
      get: () => window.innerHeight - 336,
    });
    vv.dispatchEvent(new Event("resize"));
  });
  await page.waitForSelector('.mfb__bar m3e-icon-button[aria-label="キーボードを閉じる"]');
  const barBottom = await page.evaluate(
    () => window.innerHeight - document.querySelector(".mfb__row").getBoundingClientRect().bottom,
  );
  expectTrue(
    Math.abs(barBottom - (336 + 12)) <= 2,
    `キーボードの上に出ない（下端から ${barBottom}px）`,
  );
  await shot("46b-write-compact-keyboard");
  await page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.locator('.mfb__bar m3e-icon-button[aria-label="文字の書式"]').click();
  // 46c 隣の丸い FAB（挿入）: 押すと＋が×に回り、挿入の操作が伸びて出る
  await page.locator('.mfb__fab[aria-label="挿入"]').click();
  await page.waitForSelector(".mfb__panel--insert");
  await page.waitForTimeout(500);
  await shot("46c-write-compact-fab");
  await page.locator('.mfb__fab[aria-label="挿入を閉じる"]').click();
  await page.waitForTimeout(300);
  // 47 その他（補助ペインと道具）はボトムシート
  await page.locator('.mfb__bar m3e-icon-button[aria-label="その他"]').click();
  await page.waitForTimeout(700);
  await shot("47-write-compact-more");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await v2Scenes();
}

/** 制作物一覧から名前で開き、その URL を返す */
const openWork = async (title) => {
  await go("/works");
  // 制作物一覧は広い画面では入れ子の表（題名がボタン）、compact では入れ子のリスト
  const entry = page.locator(WORKS_ENTRY, { hasText: title });
  await entry.first().waitFor();
  await entry.first().click();
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
  await page.waitForSelector(".notation__rules m3e-list-action");
  await shot("50-notation-rules");
  // 50b 行を押すと右のペインに詳細（M3 list-detail。説明・例外・厳格さ・有効／無効・履歴）
  await page.locator(".notation__rules m3e-list-action", { hasText: "A2-0001" }).click();
  await page.waitForSelector(".notation__detail .rule-editor");
  await page.waitForTimeout(400);
  await shot("50b-notation-rule-detail");
  await go("/notation?view=try");
  await page.waitForSelector("m3e-list-item.finding");
  expectTrue((await page.locator("m3e-list-item.finding").count()) >= 3, "試す: 確認箇所が出ない");
  await shot("51-notation-try");
  await signInAs("mock-nogiku-reviewer");
  await go("/notation");
  await page.waitForSelector(".notation__rules m3e-list-action");
  await btn("追加を提案").click();
  await page.waitForSelector(".notation__detail .rule-editor");
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
  // 52a カテゴリはリスト（行を押すとダイアログで名前・説明・継承・運用メモ・管理者を直す）
  await go("/notation?view=categories");
  await page.waitForSelector('m3e-action-list[aria-label="カテゴリ"] m3e-list-action');
  await shot("52a-notation-categories");

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
    () => /表記のコメント \d+ 件/.test(document.querySelector(".auto-status")?.textContent ?? ""),
    null,
    {
      timeout: 90_000,
    },
  );
  expectTrue((await page.locator(".thread .thread__bot").count()) > 0, "自動校正のコメントが無い");
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
  // 26a タッチ（compact・受付中の版）: なぞるだけではコメントを作らない（スクロール）。長押ししてからなぞると範囲が選べ、投稿欄が出る
  const posterV2 = new URL(page.url()).pathname;
  await page.setViewportSize({ width: 412, height: 915 });
  await go(posterV2);
  await pdfReady();
  await page.waitForTimeout(800);
  const touchOn = (type, x, y) =>
    page.evaluate(
      ([type, x, y]) => {
        // 比較表示なら右（新しい版）の層。コメントできるのは表示中の版だけ
        const svg = [...document.querySelectorAll(".viewer__overlay")].at(-1);
        svg.scrollIntoView({ block: "center" });
        const r = svg.getBoundingClientRect();
        svg.dispatchEvent(
          new PointerEvent(type, {
            pointerType: "touch",
            pointerId: 7,
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: r.left + x,
            clientY: r.top + y,
            bubbles: true,
          }),
        );
      },
      [type, x, y],
    );
  await touchOn("pointerdown", 80, 120);
  await touchOn("pointermove", 80, 60);
  await touchOn("pointerup", 80, 60);
  await page.waitForTimeout(700);
  expectTrue((await page.locator(".compose-pop").count()) === 0, "なぞっただけで投稿欄が出た");
  await touchOn("pointerdown", 60, 120);
  await page.waitForTimeout(650); // 長押し（450ms）
  await touchOn("pointermove", 140, 170);
  await touchOn("pointermove", 220, 230);
  await touchOn("pointerup", 220, 230);
  await page.waitForSelector(".compose-pop", { timeout: 5000 });
  expectTrue(
    (await page.locator(".viewer__overlay .anchor-draft").count()) > 0,
    "長押しで範囲が描かれない",
  );
  await page.waitForTimeout(300);
  await shot("26a-mobile-long-press");
  await page.locator('.compose-pop m3e-icon-button[aria-label="キャンセル"]').click();
  await page.waitForTimeout(300);
  // ピンチ（2 本指）で校正物だけが拡大する（アプリ全体は拡大しない）。指を離すと倍率が確定する
  const zoomBefore = await page.locator(".ws__zoom").first().innerText();
  await page.evaluate(() => {
    const stage = [...document.querySelectorAll(".viewer__stage")].at(-1);
    const r = stage.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + 200;
    const fire = (type, d) => {
      const touches =
        d === null
          ? []
          : [-1, 1].map(
              (s, i) =>
                new Touch({
                  identifier: i,
                  target: stage,
                  clientX: cx + s * d,
                  clientY: cy + s * d,
                }),
            );
      stage.dispatchEvent(
        new TouchEvent(type, { touches, changedTouches: touches, bubbles: true, cancelable: true }),
      );
    };
    fire("touchstart", 30);
    for (let d = 40; d <= 90; d += 10) fire("touchmove", d);
    fire("touchend", null);
  });
  await page.waitForTimeout(800);
  const zoomAfter = await page.locator(".ws__zoom").first().innerText();
  expectTrue(
    parseInt(zoomAfter, 10) > parseInt(zoomBefore, 10) * 2,
    `ピンチで拡大しない（${zoomBefore} → ${zoomAfter}）`,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  void poster;

  // 56–59 SNS 投稿: 編集とプレビュー → 提出 → 校正画面のプレビュー → 校了版の書き出し
  const sns = await openWork("公式 Instagram 開催告知");
  await btn("投稿を作る").click();
  await page.waitForSelector(".post-edit");
  // アカウントは制作物に割り当てた SNS アカウント（本体の設定）から写る。編集欄は本文と画像だけ
  await page.waitForSelector(".sp-figure");
  // プレビューは先に仮の名前（username）で出て、アカウントの設定を読み終えると差し替わる
  await page
    .waitForFunction(
      () => document.querySelector(".post-preview")?.textContent?.includes("mayfes_official"),
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
  expectTrue(
    (await page.locator(".post-preview").innerText()).includes("mayfes_official"),
    "割り当てた SNS アカウントがプレビューに出ない",
  );
  expectTrue(
    (await page.locator(".post-edit .card").count()) === 2,
    "編集欄が本文と画像だけでない",
  );
  await page.locator(".choice-group m3e-button", { hasText: "カルーセル" }).click();
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
  // 端末は機種で選ぶ（既定は iPhone 17。画面は実機の CSS ピクセルで組む）
  expectTrue(
    (await page.locator(".sp-caption").innerText()).includes("iPhone 17（画面 402×874"),
    "端末の機種と画面の大きさが出ない",
  );
  // 機種・表示の設定は右下の FAB から開く menu（M3 FAB menu。web では menu を使う）
  await page.locator(".preview-fab m3e-fab").click();
  await page.locator("m3e-menu-item-radio", { hasText: "プロフィールで見る" }).click();
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
  await page.waitForSelector('m3e-button:has-text("ZIP で保存")', { timeout: 20_000 });
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
  const path = resolve(here, "../../../docs/a11y-report.json");
  writeFileSync(path, JSON.stringify(a11yReport, null, 2));
  console.log("a11y report ->", path);
}
console.log("done ->", OUT);
