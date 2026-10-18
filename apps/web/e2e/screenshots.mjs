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

/**
 * 固定 sleep の代わりに、画面が落ち着くまで待つ（2 フレーム経過し、有限の animation / transition が終わるまで。Shadow DOM 内も見る）。
 * スピナーなど無限に繰り返すものは無視する。想定外の animation で止まらないよう 3 秒で打ち切る。
 */
const settle = () =>
  page.evaluate(
    () =>
      new Promise((done) => {
        const limit = performance.now() + 3000;
        // M3E は Shadow DOM 内で transition するため、document.getAnimations() では見えない。shadowRoot も辿る
        const busy = () => {
          const roots = [document];
          for (const r of roots)
            for (const el of r.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
          return roots.some((r) =>
            r.getAnimations().some((a) => {
              const t = a.effect?.getComputedTiming();
              return a.playState === "running" && t && t.iterations !== Infinity;
            }),
          );
        };
        const check = () =>
          !busy() || performance.now() > limit ? done() : requestAnimationFrame(check);
        requestAnimationFrame(() => requestAnimationFrame(check));
      }),
  );

const shot = async (name, scrollTo) => {
  await page.evaluate(async (sel) => {
    window.scrollTo(0, 0);
    if (sel) document.querySelector(sel)?.scrollIntoView({ block: "center" });
    await document.fonts.load('400 24px "Material Symbols Outlined"');
  }, scrollTo ?? null);
  await settle();
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
  await settle();
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
  await settle();
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
  await settle();
};

/** PDF の最初のページが描かれるまで待つ（連続表示では canvas は先に置かれ、画面の近くに来てから描かれる） */
const pdfReady = () =>
  page.waitForFunction(
    () => (document.querySelector(".viewer__page canvas")?.width ?? 0) > 0,
    null,
    { timeout: 30_000 },
  );
/** 自動校正の状態表示が「進行中でも失敗でもない」ところまで待つ（文言ではなく、進捗の部品とエラー表示の有無で見る） */
const autoProofreadDone = (timeout) =>
  page.waitForFunction(
    () => {
      const s = document.querySelector(".auto-status");
      return Boolean(s) && !s.querySelector("m3e-linear-progress-indicator, .error-text");
    },
    null,
    { timeout },
  );
/** 添付の切替（下部ツールバーの添付ボタン → メニュー） */
const pickArtifact = async (name) => {
  await page.locator('m3e-icon-button[aria-label="添付を切り替え"]').click();
  await page.locator("#artifact-menu m3e-menu-item:visible", { hasText: name }).first().click();
  await settle();
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
  await settle();
};

/**
 * アプリバーの「比べる」（比べる入口はここ 1 つ。利用者指示 2026-10-17）。広い画面は Menu、compact は Bottom sheet。
 * 「この制作物の版」から版を選ぶ（label は「第1版」など）。比べているときは「比べるのをやめる」も同じところ
 */
const compareButton = () => page.locator('.shell__appbar m3e-icon-button[aria-label^="比べる"]');
const isCompact = () => (page.viewportSize()?.width ?? 1440) < 600;
const openComparePicker = async () => {
  await compareButton().click();
  if (isCompact()) await page.waitForSelector("m3e-bottom-sheet.compare-sheet[open]");
  else await page.waitForSelector("#compare-menu m3e-menu-item:visible");
  await settle();
};
const comparePickItem = async (text) => {
  const item = isCompact()
    ? page.locator("m3e-bottom-sheet.compare-sheet m3e-list-action", { hasText: text }).first()
    : page.locator("#compare-menu m3e-menu-item:visible", { hasText: text }).first();
  await item.click();
  await settle();
};
const compareWithRevision = async (label) => {
  await openComparePicker();
  await comparePickItem(label);
};
/**
 * 下のツールバーの「書き込み」（印を付けたとき作るもの）: コメント / FB / なし。押すと小さな Menu。引き出しは動かさない
 * （利用者指示 2026-10-17）。このタブのあいだ覚えるので、使い終わったらコメントに戻す
 */
const openMarkMenu = async () => {
  await page.locator(".ws__toolbar .ws__mark-mode").click();
  await page.waitForSelector("#mark-mode-menu m3e-menu-item-radio:visible");
  await settle();
};
const setMarkMode = async (label) => {
  await openMarkMenu();
  await page
    .locator("#mark-mode-menu m3e-menu-item-radio:visible", { hasText: label })
    .first()
    .click();
  await settle();
};
const stopCompare = async () => {
  await openComparePicker();
  await comparePickItem("比べるのをやめる");
};

async function main() {
  // 01 サインイン
  await page.goto(`${BASE}/signin`);
  await ready();
  await page.locator(`m3e-expansion-panel [slot="header"]`).first().click();
  await shot("01-signin");

  // 02 制作物一覧（制作者）: 入れ子にせず 1 本のリスト。02b は制作担当で絞り込み、主管担当順に並べ替えたところ
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/works`);
  await page.waitForSelector(WORKS_ENTRY);
  await shot("02-works-list");
  const siteRows = () => page.locator(WORKS_ENTRY, { hasText: "公式サイト トップページ" }).count();
  expectTrue((await siteRows()) === 1, "制作物一覧で、制作物が 1 か所にない");
  const allRows = await page.locator(WORKS_ENTRY).count();
  await page.locator(".works__team--production").click();
  await settle();
  await page
    .locator("#works-production-menu m3e-menu-item-radio", { hasText: "広報局 › デザイン担当" })
    .click();
  await page.waitForURL(/production=/);
  await settle();
  const designRows = await page.locator(WORKS_ENTRY).count();
  expectTrue(
    (await siteRows()) === 1 && designRows < allRows,
    "制作担当で絞り込んでも、その担当の制作物だけにならない",
  );
  await page.locator(".works__sort").click();
  await settle();
  await page.locator("#works-sort-menu m3e-menu-item-radio", { hasText: "主管担当順" }).click();
  await page.waitForURL(/sort=owner/);
  await settle();
  await shot("02b-works-filtered");
  await go(`${BASE}/works`);
  await page.waitForSelector(WORKS_ENTRY);
  // 22 アカウントメニュー（右上のアバター）
  await page.locator('m3e-icon-button[aria-label^="アカウント"]').click();
  await settle();
  await shot("22-account-menu");
  await page.keyboard.press("Escape");
  await settle();
  // 31b レールの FAB「版を提出」→ 版を提出する制作物を選ぶ（自分が制作者の進行中の制作物を納期順。§36 L-15）
  await page.locator('m3e-nav-rail m3e-fab[aria-label="版を提出"]').click();
  await page.waitForSelector("m3e-dialog.submit-picker[open] m3e-list-action");
  await settle();
  await shot("31b-submit-picker");
  await page
    .locator('m3e-dialog.submit-picker[open] [slot="actions"] m3e-button', {
      hasText: "キャンセル",
    })
    .click();
  await page.waitForSelector("m3e-dialog.submit-picker[open]", { state: "detached" });
  await settle();
  // 31 制作物の登録は登録権限のある人だけ、制作物の一覧のアプリバーの操作から（FAB は「版を提出」に譲った）
  await page.locator('.shell__appbar m3e-icon-button[aria-label="制作物を登録"]').click();
  await page.waitForSelector("m3e-dialog[open] input");
  await settle();
  await shot("31-new-work");
  await page
    .locator('m3e-dialog[open] [slot="actions"] m3e-button', { hasText: "キャンセル" })
    .click();
  await page.waitForURL(/\/works$/);
  await settle();

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
      await settle();
      await shot("21-date-picker");
      await page.locator("m3e-datepicker m3e-button", { hasText: "キャンセル" }).click();
      await settle();
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
      // 71b 提出前の確認と申告（Notion の版 DB のチェックボックス。§58）: 3 つ確認し、写真とめいの使用を申告
      for (const id of ["theme_font", "balance", "committee_output"])
        await page.locator(`m3e-dialog[open] m3e-checkbox#self-check-${id}`).click();
      await page.locator("m3e-dialog[open] m3e-checkbox#declare-usesPhotos").click();
      await page.locator("m3e-dialog[open] m3e-checkbox#declare-usesMascot").click();
      await page
        .locator('m3e-dialog[open] .submit-checklist[aria-label="提出前の確認"]')
        .scrollIntoViewIfNeeded();
      await settle();
      await shot("71b-submit-checklist");
    },
  );
  await shot("04-submit-verified");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/1$/, { timeout: 15_000 });
  const revisionUrl = page.url();
  await pdfReady();
  // 自動校正（OCR）が終わってから撮る。固定 sleep が減ると「読み込んでいます」の途中を撮ってしまう
  await autoProofreadDone(90_000);
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
  await page.waitForSelector("m3e-dialog[open]", { state: "detached" });
  // 基本情報が長くなった（§58）ので、引き出しを上端に戻してから撮る
  await page.evaluate(() => document.querySelector(".drawer__body")?.scrollTo(0, 0));
  await settle();
  await shot("06-editor-info");

  // 15 制作物の編集（主管）: 引き出し「情報」の「編集」
  await btn("編集").click();
  await page.waitForSelector("m3e-dialog[open] m3e-input-chip");
  await shot("15-work-edit");
  // 71 Notion の制作物 DB に揃えた節（§58）: 「日程と入稿」「リンク」まで送る
  await page
    .locator('m3e-dialog[open] .form-section[aria-label="日程と入稿"]')
    .scrollIntoViewIfNeeded();
  await settle();
  await shot("71-work-edit-sections");
  await page
    .locator('m3e-dialog[open] [slot="actions"] m3e-button', { hasText: "キャンセル" })
    .click();
  await settle();

  // 07 ダッシュボード（校正者）: 「校正する」に割り当てが出る
  await signInAs("mock-nogiku-reviewer");
  await page.waitForSelector("m3e-list-action");
  await shot("07-dashboard-reviewer");
  // （36 RTL は外した。日本語だけのアプリなので RTL には対応しない。利用者決定 2026-10-15・UI_M3E §35 L-16）
  // 29 large（1200 以上）: メニューで標準の展開レール（220）。内容を押す。状態は保存され、既定は折りたたみ
  await railToggle.click();
  await page.waitForFunction(() => document.querySelector("m3e-nav-rail")?.mode === "expanded");
  await settle();
  await shot("29-rail-expanded");
  await railToggle.click();
  await page.waitForFunction(() => document.querySelector("m3e-nav-rail")?.mode === "compact");
  await settle();

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
  await page.locator(".comments__free").click();
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
    await settle();
    await page.locator(".ws__handle").hover();
    await settle();
    await shot("35-pane-drag-handle");
    await page.locator(".ws__handle").focus();
    await page.keyboard.press("Home"); // 既定幅に戻す
    await page.mouse.move(700, 400);
    await settle();
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
  await page.waitForSelector('[aria-label="専門確認"] .meta--success'); // 未完了が無くなると成功色の状態表示に替わる
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
  await settle(); // 選択後のキャレット移動（requestAnimationFrame）が済む前に打つと文字が前に入り込む
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
  await settle();
  await shot("61-home-edit");
  await page
    .locator('m3e-dialog.home-edit[open] [slot="actions"] m3e-button', { hasText: "キャンセル" })
    .click();
  await page.waitForSelector("m3e-dialog.home-edit[open]", { state: "detached" });
  await settle();

  // 09 採否判断（制作者）: ⋮ → 不採用（理由）
  await go(revisionUrl);
  await page.waitForSelector(".comments .thread");
  const first = page.locator(".comments .thread").first();
  await first.locator(".thread__body").click();
  await settle();
  await first.locator('m3e-icon-button[aria-label="その他の操作"]').click();
  await settle();
  await page.locator("m3e-menu-item:visible", { hasText: "不採用" }).click();
  await page.fill(".thread textarea", "正式名称は「五月祭常任委員会」で正しいことを規約で確認済み");
  await page.locator(".thread m3e-button", { hasText: "不採用" }).click();
  await page.waitForSelector(".comments .thread--closed");
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
  const threadsBeforeCarry = await page.locator(".comments .thread").count();
  await page
    .locator('[aria-label="前版の未解決コメント"] m3e-button', { hasText: "この版へ持ち越す" })
    .first()
    .click();
  await page.waitForFunction(
    (n) => document.querySelectorAll(".comments .thread").length > n,
    threadsBeforeCarry,
  );
  // 25 版の比較（アプリバーの「比べる」→「この制作物の版」）
  await drawer("版");
  await shot("28-versions");
  await openComparePicker();
  await shot("25a-compare-picker");
  await comparePickItem("第1版");
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
    await settle();
  }
  await page.evaluate(() =>
    [...document.querySelectorAll(".compare__pane .viewer__stage")].at(-1).scrollBy(120, 240),
  );
  await settle();
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
  // 比べているあいだはボタンが選択状態で、同じところに「比べるのをやめる」
  expectTrue(
    (await compareButton().getAttribute("selected")) !== null,
    "比べている間、比べるボタンが選択状態にならない",
  );
  await stopCompare();
  await page.waitForFunction(() => document.querySelectorAll(".compare__pane").length === 0);
  expectTrue(
    (await compareButton().getAttribute("selected")) === null,
    "比べるのをやめても、比べるボタンが選択状態のまま",
  );

  // 38 比較しながら新しい版にコメント（校正者）: 第1版を開いて第2版と比較 → 第2版が右（操作できる側）に入れ替わる
  await signInAs("mock-nogiku-reviewer");
  await go(revision2Url.replace(/\/v\/2$/, "/v/1"));
  await pdfReady();
  await compareWithRevision("第2版");
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
  await page.waitForSelector(".comments .thread--closed");

  // 10 校了ダイアログ（校了権限者）と校了後: 引き出し「情報」
  await signInAs("mock-nogiku-approver");
  await go(workUrl);
  await pdfReady();
  await drawer("情報");
  await btn("校了を宣言").click();
  await page.waitForSelector("m3e-dialog[open]");
  await shot("10-finalize-dialog");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "校了を確定する" }).click();
  await page.waitForSelector("m3e-dialog[open]", { state: "detached", timeout: 15_000 });
  await shot("11-work-finalized");

  // 18 通知（校正者）: アプリバーのベルのパネル
  await signInAs("mock-nogiku-reviewer");
  await page.locator('.bell m3e-icon-button[aria-label^="通知"]').click();
  await page.waitForSelector("#notif-menu .notif");
  await settle();
  await shot("18-notifications");
  await page.keyboard.press("Escape");
  await settle();

  // 13 管理画面 / 12 閲覧権限（管理者）: 管理画面のダイアログ（管理者は内容を閲覧しない: D3）
  await signInAs("mock-nogiku-admin");
  await go(`${BASE}/admin`);
  const adminWorks = 'm3e-action-list[aria-label="制作物ごとの閲覧権限"] m3e-list-action';
  await page.waitForSelector(adminWorks);
  await shot("13-admin-works");
  await page.locator(adminWorks).first().click();
  await page.waitForSelector("m3e-dialog[open] .acl");
  await settle();
  await shot("12-acl");
  await page.locator('m3e-dialog[open] [slot="actions"] m3e-button', { hasText: "閉じる" }).click();
  await settle();
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
  await settle();
  // 下のツールバーの「書き込み」を FB にして、紙面の範囲を選ぶ（投稿欄の右上の切り替えは無くした）
  await openMarkMenu();
  await shot("64a-mark-mode-menu");
  await page
    .locator("#mark-mode-menu m3e-menu-item-radio:visible", { hasText: "FB" })
    .first()
    .click();
  await settle();
  {
    const box = await page.locator(".viewer__overlay").first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.4, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForSelector(".compose-pop textarea");
  expectTrue(
    (await page.locator(".compose-pop__kind").count()) === 0,
    "投稿欄にコメント／FB の切り替えが残っている",
  );
  expectTrue(
    (await page.locator(".compose-pop__note").innerText()).includes("FB"),
    "FB のモードなのに、投稿欄が FB と示さない",
  );
  await page.fill(".compose-pop textarea", "ここの余白、もう少し詰めても良さそう？ 迷っています");
  await page.locator(".compose-pop m3e-button", { hasText: "FB で相談" }).click();
  await page.waitForSelector(".fb-pane--thread .fb-post");
  await page.waitForSelector(".anchor-pin--fb");
  await shot("64-editor-fb");
  // 書き込みはこのタブのあいだ覚えている（受付終了のこの版では「コメント」は選べない）。コメントに戻すのは、コメントできる版で（下の 39 の前）
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

  // 73 書き込み「なし」（利用者指示 2026-10-17）: 印を付けず、PDF の中のリンクが押せる。外部の URL は新しいタブ（noopener noreferrer）、
  //    ページ内のリンクはそのページへ。コメント・FB のモードではリンクの層を出さない（印の層がなぞるを受ける）
  await go(revisionUrl);
  await pdfReady();
  await context.route("https://example.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>リンク先</title>" }),
  );
  expectTrue(
    (await page.locator(".viewer__page .pdf-link").count()) === 0,
    "FB のモードなのに、PDF のリンクの層が出ている",
  );
  await setMarkMode("なし");
  await page.waitForSelector('.viewer__page[data-page="1"] a.pdf-link');
  const links = await page
    .locator('.viewer__page[data-page="1"] a.pdf-link')
    .evaluateAll((els) =>
      els.map((e) => ({ href: e.getAttribute("href"), target: e.target, rel: e.rel })),
    );
  expectTrue(
    links.some(
      (l) =>
        l.href === "https://example.com/mf100" &&
        l.target === "_blank" &&
        /noopener/.test(l.rel) &&
        /noreferrer/.test(l.rel),
    ),
    `外部リンクが new タブ・noopener noreferrer で出ない: ${JSON.stringify(links)}`,
  );
  await shot("73-pdf-links-no-mark");
  // 紙面をなぞっても投稿欄（コメント・FB）は出ない
  {
    const box = await page.locator(".viewer__overlay").first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    expectTrue(
      (await page.locator(".compose-pop").count()) === 0,
      "書き込みが「なし」なのに、紙面をなぞると投稿欄が出る",
    );
  }
  // 外部リンクは新しいタブで開く
  {
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.locator('.viewer__page[data-page="1"] a.pdf-link[href^="https://"]').click(),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    expectTrue(
      popup.url().startsWith("https://example.com/mf100"),
      `新しいタブの URL: ${popup.url()}`,
    );
    await popup.close();
  }
  // ページ内のリンクはそのページへ
  await page.locator('.viewer__page[data-page="1"] a.pdf-link[href^="#page-"]').click();
  await page.waitForFunction(
    () => {
      const st = document.querySelector(".viewer__stage").getBoundingClientRect();
      const p2 = document.querySelector('.viewer__page[data-page="2"]').getBoundingClientRect();
      return Math.abs(p2.top - st.top) < 80;
    },
    null,
    { timeout: 5000 },
  );
  // FB に戻すと、リンクの層は出ない（印の層がなぞるを受ける。リンクは印を付ける操作を奪わない）
  await setMarkMode("FB");
  expectTrue(
    (await page.locator(".viewer__page .pdf-link").count()) === 0,
    "FB のモードに戻しても、PDF のリンクの層が残っている",
  );

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
  await settle();
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
  await settle();
  await shot("20-mobile-dashboard");
  await page.locator(".shell__appbar .bell m3e-icon-button").click();
  await page.waitForSelector("m3e-bottom-sheet.notif-sheet .notif");
  await settle();
  await shot("32-mobile-notifications");
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.notif-sheet").hide());
  await settle();
  // 33 compact の制作物一覧（リストは端から端まで、題名の左端 16 と揃う。右下に FAB「版を提出」）
  await go(`${BASE}/works`);
  await page.waitForSelector("m3e-list-action");
  await shot("33-mobile-works");
  await signInAs("mock-nogiku-reviewer");
  // 26 compact のエディタ: 共通バーは消え、エディタのトップアプリバー。紙面は画面いっぱいで、引き出し（コメント・版・情報）はツールバーから開くボトムシート
  await go(revision2Url);
  await pdfReady();
  await page.waitForSelector("m3e-bottom-sheet.ws__sheet"); // 通知のシート（非表示）と区別する
  await settle();
  await shot("26-mobile-workspace");
  // 37 compact の補助的な選択はボトムシート（Breakpoints: compact は Bottom sheet、medium 以上は Menu）。添付が複数ある第1版で
  await go(revisionUrl);
  await pdfReady();
  await settle();
  await page.locator('m3e-icon-button[aria-label="添付を切り替え"]').click();
  await page.waitForSelector("m3e-bottom-sheet.action-sheet .list__item");
  await settle();
  await shot("37-mobile-action-sheet");
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.action-sheet").hide());
  await settle();
  await go(revision2Url);
  await pdfReady();
  await settle();
  // 34 引き出しは普段は閉じていて、ツールバーの「コメント」で半分まで開く
  await page.locator('.ws__toolbar m3e-icon-button[aria-label^="コメント"]').click();
  await settle();
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
  await settle();
  await shot("65-mobile-editor-fb");
  // 開いている間はシートがツールバーに重なる（中のタブで切り替え、下に払うと閉じる）
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.ws__sheet").hide());
  await settle();
  // 65b 狭い画面のツールバーにも「書き込み」（コメント / FB / なし）。押すと小さな Menu
  await openMarkMenu();
  await shot("65b-mobile-mark-mode");
  await page.keyboard.press("Escape");
  await settle();
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
  await page.waitForFunction(() => Boolean(document.querySelector(".write__status--saved")), null, {
    timeout: 15_000,
  });
  await shot("39-write-editor");
  // 39a サイドレールの「エディタ」: 書ける担当の制作物を選ぶ（最近書いた下書きが上）→ 選ぶとエディタへ
  await page.locator('m3e-nav-item[data-to="/write"]').first().click();
  await page.waitForURL(/\/write$/);
  await page.waitForSelector(".write-picker m3e-list-action");
  const firstPick = await page.locator(".write-picker m3e-list-action").first().innerText();
  expectTrue(
    firstPick.includes("公式サイト トップページ"),
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
  await settle();
  await shot("40-write-style-menu");
  await page.keyboard.press("Escape");
  await settle();
  // 41 検索と置換（Ctrl+H）: 補助ペインで検索しながら編集を続けられる
  await page.click(".doc");
  await page.keyboard.press("Control+h");
  await page.waitForSelector(".find input");
  await page.locator(".find input").first().fill("五月祭");
  await page.keyboard.press("Enter");
  await settle();
  await shot("41-write-find");
  // 42 文字カウント（その他メニュー → 文字カウント。入力中に表示も切り替えられる）
  await page.locator("#wt-more").click();
  await settle();
  await page.locator("#wt-more-menu m3e-menu-item", { hasText: "文字カウント" }).click();
  await page.waitForSelector("m3e-dialog[open] .count-list");
  await settle();
  await shot("42-write-word-count");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "完了" }).click();
  await settle();
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
  await page.waitForSelector("m3e-dialog[open]", { state: "detached" });
  // 43 校正（校正者）: 書式付きのまま表示され、文字を選ぶとその場に投稿欄
  await signInAs("mock-nogiku-reviewer");
  await go(writeWorkUrl);
  // 書き込みはこのタブのあいだ覚えていて、64 で FB にしたまま。ここはコメントできる版なので、コメントに戻す
  await page.waitForSelector(".ws__toolbar .ws__mark-mode");
  await setMarkMode("コメント");
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
  await settle();
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
  await settle();
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
  await settle();
  // 45 コメントを見ながら直す（制作者）: 補助ペイン「コメント」→ 押すと本文の該当箇所を選ぶ
  await signInAs("mock-nogiku-creator");
  await go(`${writeWorkUrl}/write`);
  await page.waitForSelector(".doc[contenteditable=true]");
  await page.locator('.write__side m3e-icon-button[aria-label="コメント"]').click();
  await page.waitForSelector(".refs__item");
  await page.locator(".refs__item").first().click();
  await settle();
  const picked = await page.evaluate(() => getSelection()?.toString() ?? "");
  if (!picked.includes("百花繚乱")) throw new Error(`コメントから本文を選べない: ${picked}`);
  await shot("45-write-refs");
  // 46 compact の文章エディタ: 画面下に浮かぶ vibrant のツールバー
  await page.setViewportSize({ width: 412, height: 915 });
  await settle();
  await page.click(".doc");
  await shot("46-write-compact");
  // 46a 丸いボタン（文字の書式）で 2 本目のツールバーが伸びる。押しても本文のフォーカスは外れない
  await page.locator('.mfb__bar m3e-icon-button[aria-label="文字の書式"]').click();
  await page.waitForSelector(".mfb__panel--text");
  await settle();
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
  await settle();
  await shot("46c-write-compact-fab");
  await page.locator('.mfb__fab[aria-label="挿入を閉じる"]').click();
  await settle();
  // 47 その他（補助ペインと道具）はボトムシート
  await page.locator('.mfb__bar m3e-icon-button[aria-label="その他"]').click();
  await settle();
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
  await settle();
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
  await page.waitForSelector(".rule-table tbody tr[data-id]");
  await shot("50-notation-rules");
  // 50b 表の行を押すと右のペインに詳細（§54 の表 ＋ M3 Supporting pane。説明・例外・厳格さ・有効／無効・履歴）
  await page.locator(".rule-table tbody tr[data-id]", { hasText: "A2-0001" }).click();
  await page.waitForSelector(".notation__detail .rule-editor");
  await settle();
  await shot("50b-notation-rule-detail");
  await go("/notation?view=try");
  await page.waitForSelector("m3e-list-item.finding");
  expectTrue((await page.locator("m3e-list-item.finding").count()) >= 3, "試す: 確認箇所が出ない");
  await shot("51-notation-try");
  await signInAs("mock-nogiku-reviewer");
  await go("/notation");
  await page.waitForSelector(".rule-table tbody tr[data-id]");
  await btn("追加を提案").click();
  await page.waitForSelector(".notation__detail .rule-editor");
  const ed = page.locator(".notation__detail");
  await ed.locator("input").nth(1).fill("ウェブ");
  await ed.locator("textarea").nth(0).fill("Web");
  await ed.locator("textarea").nth(1).fill("ウェッブ");
  await ed.locator("m3e-button", { hasText: "追加を提案" }).click();
  await page.waitForSelector("m3e-snackbar"); // 提案を受けた知らせが出たら送れている
  await signInAs("mock-nogiku-admin");
  await go("/notation?view=proposals");
  await page.waitForSelector("m3e-card.proposal");
  await shot("52-notation-proposals");
  // 52a カテゴリはリスト（行を押すとダイアログで名前・説明・継承・運用メモ・管理者を直す）
  await go("/notation?view=categories");
  await page.waitForSelector('m3e-action-list[aria-label="カテゴリ"] m3e-list-action');
  await page.waitForSelector("m3e-snackbar", { state: "detached" }); // 52 の知らせ（4 秒）が消えてから撮る
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
  await autoProofreadDone(90_000);
  expectTrue((await page.locator(".thread .thread__bot").count()) > 0, "自動校正のコメントが無い");
  await shot("54-auto-proofread");
  await compareWithRevision("第1版");
  await page.waitForFunction(
    () => document.querySelector(".compare-status")?.textContent?.includes("追加 1"),
    null,
    {
      timeout: 30_000,
    },
  );
  await settle();
  await shot("55-compare-pdf");
  // 67 別の制作物と比べる（利用者指示 2026-10-17）: アプリバーの「比べる」→「ほかの制作物」→ 制作物を検索して選ぶ → 最新の版が選ばれている →「比べる」
  //    左の見出しは「題名・版」、比較の状況に「別の制作物」、比べるボタンは選択状態
  await openComparePicker();
  await shot("67a-compare-picker-menu");
  await comparePickItem("制作物を探して比べる");
  await page.waitForSelector(".cross-picker[open] .cross-picker__list m3e-list-action");
  await page.fill(".cross-picker[open] input", "パンフレット");
  await page.waitForTimeout(500);
  await page
    .locator(".cross-picker[open] m3e-list-action", { hasText: "MF100 公式パンフレット" })
    .click();
  await page.waitForSelector(".cross-picker[open] m3e-list-action.list__item--selected");
  // 版の並びは新しい順。先頭（最新）の版が選ばれている
  expectTrue(
    await page
      .locator(".cross-picker[open] .cross-picker__list m3e-list-action")
      .first()
      .evaluate((el) => el.classList.contains("list__item--selected")),
    "最新の版が選ばれていない",
  );
  await page.locator(".cross-picker[open] m3e-button", { hasText: "比べる" }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".compare__label--other")
        ?.textContent?.startsWith("MF100 公式パンフレット・第"),
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".compare__pane")].every(
        (p) => (p.querySelector(".viewer__page canvas")?.width ?? 0) > 0,
      ),
    null,
    { timeout: 30_000 },
  );
  // 相手を替えた後にページの対応を解析し直す（前の組の結果を引きずらない）
  await page.waitForFunction(
    () =>
      /ページ対応: 旧 [1-9]\d* → 新 [1-9]/.test(
        document.querySelector(".compare-status")?.textContent ?? "",
      ),
    null,
    { timeout: 30_000 },
  );
  expectTrue(
    (await page.locator(".compare-status").innerText()).includes("MF100 公式パンフレット"),
    "比較の状況に相手の制作物の題名が出ない",
  );
  expectTrue(
    (await compareButton().getAttribute("selected")) !== null,
    "別の制作物と比べている間、比べるボタンが選択状態にならない",
  );
  await page.waitForTimeout(800);
  await shot("67-compare-cross-work");
  // 26a タッチ（compact・受付中の版）: なぞるだけではコメントを作らない（スクロール）。長押ししてからなぞると範囲が選べ、投稿欄が出る
  const posterV2 = new URL(page.url()).pathname;
  await page.setViewportSize({ width: 412, height: 915 });
  await go(posterV2);
  await pdfReady();
  await settle();
  // 67b compact: アプリバーの「比べる」はピンの横。押すと Bottom sheet（この制作物の版・ほかの制作物）→ 相手を選ぶダイアログは全画面（M3 Dialogs）
  await openComparePicker();
  await shot("67c-compare-sheet-compact");
  await comparePickItem("制作物を探して比べる");
  await page.waitForSelector(".cross-picker[open] .cross-picker__list m3e-list-action");
  await shot("67b-compare-cross-picker-compact");
  await page.locator(".cross-picker[open] m3e-button", { hasText: "キャンセル" }).click();
  await page.waitForSelector(".cross-picker[open]", { state: "detached" });
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.ws__sheet").hide());
  await page.waitForTimeout(600);
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
  // 26b 長押しの途中: 指の周りの輪が満ちていく（長押しの手応え）
  await page.waitForTimeout(220);
  expectTrue(
    (await page.locator(".press-layer .press-charge").count()) === 1,
    "長押しの輪が出ない",
  );
  // shot() は撮る前に待つので、長押しが満ちる前のこの瞬間はそのまま撮る
  await page.screenshot({ path: resolve(OUT, "26b-mobile-press-charge.png") });
  console.log("saved 26b-mobile-press-charge");
  await page.waitForTimeout(250); // 長押し（320ms）が満ちるまで
  await touchOn("pointermove", 140, 170);
  await touchOn("pointermove", 220, 230);
  await touchOn("pointerup", 220, 230);
  await page.waitForSelector(".compose-pop", { timeout: 5000 });
  expectTrue(
    (await page.locator(".viewer__overlay .anchor-draft").count()) > 0,
    "長押しで範囲が描かれない",
  );
  await settle();
  await shot("26a-mobile-long-press");
  await page.locator('.compose-pop m3e-icon-button[aria-label="キャンセル"]').click();
  await settle();
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
  await page.waitForFunction(
    (before) => document.querySelector(".ws__zoom")?.innerText !== before,
    zoomBefore,
    { timeout: 5000 },
  );
  await settle();
  const zoomAfter = await page.locator(".ws__zoom").first().innerText();
  expectTrue(
    parseInt(zoomAfter, 10) > parseInt(zoomBefore, 10) * 2,
    `ピンチで拡大しない（${zoomBefore} → ${zoomAfter}）`,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle();
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
  // 端末は機種で選ぶ（既定は iPhone 17。画面は実機の CSS ピクセル 402×874 で組む。注記の文は 416186b で外した）
  expectTrue(
    await page
      .locator(".sp-device")
      .first()
      .evaluate((el) => el.style.width === "402px" && el.style.height === "874px"),
    "既定の端末（iPhone 17・402×874）で組まれていない",
  );
  // 機種・表示の設定は右下の FAB から開く menu（M3 FAB menu。web では menu を使う）
  await page.locator(".preview-fab m3e-fab").click();
  await page.locator("m3e-menu-item-radio", { hasText: "プロフィールで見る" }).click();
  await settle();
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
    (await page.locator('.post-review m3e-icon[name="folder_zip"]').count()) === 0,
    "校了前に書き出せてしまう",
  );
  await shot("58-sns-review");

  // 59a SNS のプレビューの上で、本文の範囲・画像の矩形とピンを指してコメントする（利用者指示 2026-10-17）。
  // スマホの幅（412×915）で、端末の枠に入ったプレビューのまま。位置は提出した版の本文のオフセットと元画像の正規化座標で保存される
  await signInAs("mock-nogiku-reviewer");
  await page.setViewportSize({ width: 412, height: 915 });
  await go(`${sns}/v/1`);
  await page.waitForSelector(".sp-ig__slide .sp-marks.is-drawable", { timeout: 20_000 });
  await settle();
  // コメントは投稿の後にサーバーから届いて印になる（投稿欄が閉じた直後はまだ無い）ので、出るまで待つ
  const marksShown = (selector, message) =>
    page
      .waitForFunction((sel) => document.querySelector(sel) !== null, selector, { timeout: 8000 })
      .catch(() => {
        throw new Error(message);
      });
  // カルーセルの送りは滑らかなスクロールなので、画像が枠にぴったり止まるまで待つ（途中で撮ると次の画像がはみ出して写る）
  const carouselSettled = (index) =>
    page.waitForFunction(
      (i) => {
        const t = document.querySelector(".sp-figure .sp-ig__track");
        return t !== null && Math.abs(t.scrollLeft - i * t.clientWidth) < 1.5;
      },
      index,
      { timeout: 5000 },
    );
  const postComment = async (body) => {
    await page.waitForSelector(".compose-pop textarea");
    await page.fill(".compose-pop textarea", body);
    await page.locator(".compose-pop m3e-button", { hasText: "投稿" }).click();
    await page.waitForSelector(".compose-pop", { state: "detached" });
    await settle();
  };
  // 本文: 文字を選ぶとその範囲にコメントできる。端末の枠は CSS の zoom で縮めて見せているので、位置は測った座標で指す
  const selectInCaption = async (n) => {
    const r = await page.evaluate((needle) => {
      const root = document.querySelector(".sp-figure .sp-text");
      root.scrollIntoView({ block: "center" });
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        const i = t.data.indexOf(needle);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(t, i);
        range.setEnd(t, i + needle.length);
        const b = range.getBoundingClientRect();
        return { x: b.left, y: b.top, w: b.width, h: b.height };
      }
      return null;
    }, n);
    expectTrue(r !== null, `プレビューの本文に「${n}」が見つからない`);
    await page.mouse.move(r.x + 1, r.y + r.h / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.w - 1, r.y + r.h / 2, { steps: 6 });
    await page.mouse.up();
  };
  const needle = "五月祭";
  await selectInCaption(needle);
  await postComment("「五月祭」の表記は正式名称に統一してください（本文の範囲）");
  await marksShown(".sp-figure .sp-mark-text", "本文の範囲のコメントが強調されない");
  expectTrue(
    (await page.locator(".sp-figure .sp-mark-text", { hasText: needle }).count()) >= 1,
    "本文の範囲のコメントが、選んだ文字の上に強調されない",
  );
  // 画像 1 枚目: ドラッグした矩形にコメントできる
  const slide1 = page.locator(".sp-ig__slide").nth(0).locator(".sp-marks");
  const drag = async (layer, x0, y0, x1, y1) => {
    await layer.scrollIntoViewIfNeeded();
    const b = await layer.boundingBox();
    await page.mouse.move(b.x + b.width * x0, b.y + b.height * y0);
    await page.mouse.down();
    if (x1 !== undefined)
      await page.mouse.move(b.x + b.width * x1, b.y + b.height * y1, { steps: 8 });
    await page.mouse.up();
  };
  await drag(slide1, 0.15, 0.2, 0.6, 0.5);
  await postComment("ポスターのロゴが小さいので大きくしてください（画像 1 の矩形）");
  await marksShown(".sp-figure .sp-ig__slide:first-child .sp-mark--rect", "画像の矩形の印が出ない");
  // 位置は画像の中の割合（端末の枠・拡大率に依存しない）。ここで測って、後で別の画面の大きさと比べる
  const rectRatio = () =>
    page.evaluate(() => {
      const m = document
        .querySelector(".sp-figure .sp-ig__slide .sp-mark--rect")
        .getBoundingClientRect();
      const l = document
        .querySelector(".sp-figure .sp-ig__slide .sp-marks")
        .getBoundingClientRect();
      return [
        (m.left - l.left) / l.width,
        (m.top - l.top) / l.height,
        m.width / l.width,
        m.height / l.height,
      ];
    });
  const ratioMobile = await rectRatio();
  // 画像 2 枚目: 次の画像へ送ってクリックでピン
  await page.locator(".sp-figure .sp-nav--next").click();
  await page.waitForFunction(
    () => document.querySelector(".sp-figure .sp-ig__count")?.textContent === "2/2",
  );
  await carouselSettled(1);
  await drag(page.locator(".sp-ig__slide").nth(1).locator(".sp-marks"), 0.7, 0.6);
  await postComment("この画像の右下は切れて見えます（画像 2 のピン）");
  await marksShown(".sp-figure .sp-mark--point", "画像のピンが出ない");
  // 1 枚目へ戻して撮る: 本文の強調と 1 枚目の矩形が同時に見える
  await page.locator(".sp-figure .sp-nav--prev").click();
  await page.waitForFunction(
    () => document.querySelector(".sp-figure .sp-ig__count")?.textContent === "1/2",
  );
  await carouselSettled(0);
  await page.evaluate(() =>
    document.querySelector(".sp-figure .sp-text").scrollIntoView({ block: "center" }),
  );
  await shot("59a-sns-anchored-comments");
  // 59b コメントを開くと、その画像へ送って位置を強調する（ピンは 2 枚目。いまは 1 枚目を見ている）
  await page.locator('.ws__toolbar m3e-icon-button[aria-label^="コメント"]').click();
  await settle();
  // ピンのコメントのカード（番号は自動校正のコメントも数えるので、書いた文で探す）を押す
  await page.locator("m3e-bottom-sheet.ws__sheet .thread", { hasText: "画像 2 のピン" }).click();
  await page.waitForFunction(
    () => document.querySelector(".sp-figure .sp-ig__count")?.textContent === "2/2",
    null,
    { timeout: 5000 },
  );
  await carouselSettled(1);
  await marksShown(".sp-figure .sp-mark--point.is-active", "開いたコメントの印が強調されない");
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.ws__sheet").hide());
  await settle();
  await shot("59b-sns-anchored-open");
  // 本文の印を押すとそのコメントを開く
  // （端末の枠は CSS の zoom で縮めて見せているので、押す位置は測った座標で指す）
  const markBox = await page
    .locator(".sp-figure .sp-mark-text", { hasText: needle })
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  await page.mouse.click(markBox.x, markBox.y);
  await marksShown(".sp-figure .sp-mark-text.is-active", "本文の強調を押してもコメントが開かない");
  // （本文の強調を押すと、狭い画面ではそのコメントが見えるようにシートが開く。閉じてから続ける）
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.ws__sheet").hide());
  await settle();
  // 「… 続きを読む」の先の本文にもコメントでき、そのコメントを開くと本文が開いて強調される
  const moreBox = await page.locator(".sp-figure .sp-more").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(moreBox.x, moreBox.y);
  await page.waitForFunction(() => document.querySelector(".sp-figure .sp-more") === null);
  await selectInCaption("ご覧ください");
  await postComment("続きの本文にもコメントできます（「続きを読む」の先）");
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll(".sp-figure .sp-mark-text")].some((e) =>
          e.textContent.includes("ご覧"),
        ),
      null,
      { timeout: 8000 },
    )
    .catch(() => {
      throw new Error("続きの本文の強調が出ない");
    });
  await go("/works");
  await go(`${sns}/v/1`); // 開き直すと、キャプションはまた 2 行で切られている
  await page.waitForSelector(".sp-figure .sp-more", { timeout: 20_000 });
  await page.locator('.ws__toolbar m3e-icon-button[aria-label^="コメント"]').click();
  await settle();
  await page.locator("m3e-bottom-sheet.ws__sheet .thread", { hasText: "続きの本文にも" }).click();
  await page.waitForFunction(() => document.querySelector(".sp-figure .sp-more") === null, null, {
    timeout: 5000,
  });
  await marksShown(
    ".sp-figure .sp-mark-text.is-active",
    "続きの本文のコメントを開いても強調されない",
  );
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.ws__sheet").hide());
  await settle();
  // 広い画面（別の大きさ）でも、同じコメントが画像の同じ場所に付く
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle();
  await page.waitForSelector(".sp-figure .sp-mark--rect");
  await page
    .locator(".sp-figure .sp-nav--prev")
    .click()
    .catch(() => {});
  await page.waitForFunction(
    () => document.querySelector(".sp-figure .sp-ig__count")?.textContent === "1/2",
  );
  const ratioDesktop = await rectRatio();
  expectTrue(
    ratioMobile.every((v, i) => Math.abs(v - ratioDesktop[i]) < 0.01),
    `画像の矩形の位置が画面の大きさで変わる（${ratioMobile.join(",")} → ${ratioDesktop.join(",")}）`,
  );
  // 付けたコメントは未解決のままだと理由なしでは校了できないので、制作者が ✓ で反映済みにする
  await page.setViewportSize({ width: 412, height: 915 });
  await signInAs("mock-nogiku-creator");
  await go(`${sns}/v/1`);
  await page.waitForSelector(".sp-figure .sp-mark--rect", { timeout: 20_000 });
  const openComments = async () => {
    await page.locator('.ws__toolbar m3e-icon-button[aria-label^="コメント"]').click();
    await settle();
  };
  await openComments();
  for (let i = 0; i < 10; i++) {
    const resolveBtn = page
      .locator('m3e-bottom-sheet.ws__sheet .thread m3e-icon-button[aria-label^="解決"]')
      .first();
    if ((await resolveBtn.count()) === 0) break;
    await page.locator("m3e-bottom-sheet.ws__sheet .thread .thread__body").first().click();
    await resolveBtn.click();
    await page.waitForTimeout(500);
  }
  expectTrue(
    (await page
      .locator('m3e-bottom-sheet.ws__sheet .thread m3e-icon-button[aria-label^="解決"]')
      .count()) === 0,
    "プレビューに付けたコメントを反映済みにできない",
  );
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.ws__sheet").hide());
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs("mock-nogiku-approver");
  await go(`${sns}/v/1`);
  await page.waitForSelector(".sp-figure", { timeout: 20_000 });
  await drawer("情報");
  await btn("校了を宣言").click();
  await page.waitForSelector("m3e-dialog[open]");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "校了を確定する" }).click();
  // 書き出しは校了後だけ、プレビューの右上のボタンから menu
  await page.waitForSelector('.post-preview__bar m3e-icon[name="download"]', { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.waitForSelector("m3e-snackbar", { state: "detached" }); // 57 の知らせ（8 秒）が消えてから撮る
  await page.locator('.post-preview__bar m3e-icon-button:has(m3e-icon[name="download"])').click();
  await page.waitForSelector('m3e-menu-item:has(m3e-icon[name="folder_zip"])', {
    state: "visible",
  });
  await shot("59-sns-export");
  await page.keyboard.press("Escape");

  // 60 表記ルール（compact）
  await page.setViewportSize({ width: 412, height: 915 });
  await go("/notation");
  await page.waitForSelector("m3e-list-action");
  await shot("60-notation-compact");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 66 動画の校正（利用者指示 2026-10-17）: 制作者が動画を提出し、校正者が時点・範囲・画面の位置でコメントする
  await signInAs("mock-nogiku-creator");
  await go("/works");
  await page.locator(WORKS_ENTRY, { hasText: "MF100 告知動画" }).first().click();
  await page.waitForURL(/\/works\/[^/]+$/);
  const videoWork = page.url();
  await submitRevision("最初の版を提出", [resolve(FIXTURES, "promo.webm")], "初稿の告知動画");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/1$/, { timeout: 15_000 });
  await signInAs("mock-nogiku-reviewer");
  await go(videoWork);
  const videoReady = () =>
    page.waitForFunction(
      () => (document.querySelector(".vplayer video")?.readyState ?? 0) >= 1,
      null,
      {
        timeout: 20_000,
      },
    );
  await videoReady();
  const postVideo = async (body) => {
    await page.waitForSelector(".compose-pop textarea");
    await page.fill(".compose-pop textarea", body);
    await page.locator(".compose-pop m3e-button", { hasText: "投稿" }).click();
    await page.waitForSelector(".compose-pop", { state: "detached" });
  };
  const seekTo = async (ratio) => {
    const tb = await page.locator(".vtl__track").boundingBox();
    await page.mouse.click(tb.x + tb.width * ratio, tb.y + tb.height / 2);
    await page.waitForFunction(() => !document.querySelector(".vplayer video").seeking);
    await settle();
  };
  // 時点: 3 秒で止めて C
  await seekTo(0.25);
  await page.locator(".vplayer").focus();
  await page.keyboard.press("c");
  await page.waitForSelector(".compose-pop__place");
  expectTrue(
    (await page.locator(".compose-pop__place").innerText()).includes("0:03"),
    "動画の投稿欄に時点が出ない",
  );
  await postVideo("ここで音が途切れる");
  // 範囲: タイムラインの上の段を 6 秒 → 9 秒までなぞる
  const lb = await page.locator(".vtl__lane").boundingBox();
  await page.mouse.move(lb.x + lb.width * 0.5, lb.y + lb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width * 0.75, lb.y + lb.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector(".compose-pop__place");
  expectTrue(
    (await page.locator(".compose-pop__place").innerText()).includes("0:06–0:09"),
    "タイムラインをなぞっても範囲にならない",
  );
  await shot("66b-video-range-compose");
  await postVideo("この間のテロップが速すぎる");
  // 画面の位置: 1 秒で止めて映像の左上をドラッグ
  await seekTo(1 / 12);
  const fr = await page.locator(".vplayer__frame").boundingBox();
  await page.mouse.move(fr.x + fr.width * 0.05, fr.y + fr.height * 0.05);
  await page.mouse.down();
  await page.mouse.move(fr.x + fr.width * 0.4, fr.y + fr.height * 0.2, { steps: 8 });
  await page.mouse.up();
  await postVideo("タイムコードの表示を消す");
  await page.waitForFunction(() => document.querySelectorAll(".vtl__mark").length === 3, null, {
    timeout: 5000,
  });
  expectTrue(
    (await page.locator(".vtl__mark").count()) === 3 &&
      (await page.locator(".vtl__bar").count()) === 1,
    "タイムラインに時点・範囲の印が出ない",
  );
  // カードの時刻を押すとその時刻へ移って止まり、画面の範囲が重なる
  await seekTo(0.9);
  await page
    .locator(".thread", { hasText: "タイムコードの表示を消す" })
    .locator(".thread__index")
    .click();
  await page.waitForFunction(() => !document.querySelector(".vplayer video").seeking);
  const at = await page.evaluate(() => document.querySelector(".vplayer video").currentTime);
  expectTrue(Math.abs(at - 1) < 0.05, `カードの時刻へ移らない（${at}）`);
  expectTrue((await page.locator(".vplayer .anchor-rect").count()) === 1, "画面の範囲が重ならない");
  await shot("66-video-review");
  await webFigmaScenes();
}

/** 67 Web サイトのライブ表示・68 Figma の取り込みと埋め込み（利用者指示 2026-10-17）。E2E は小さく: 提出 → コメント → 端末の切り替え → 撮影 */
async function webFigmaScenes() {
  // 68 Web: 制作者が公式サイトの版を見本サイト（同じオリジン）の URL で提出し、校正者がライブ表示の要素にコメントする
  await signInAs("mock-nogiku-creator");
  const siteWork = await openWork("公式サイト トップページ");
  // 19・55 でこの制作物には版があるので、引き出し「版」から新しい版として出す
  await drawer("版");
  await btn("新しい版を提出").click();
  // Web の制作物はファイルを出さず、サイトの URL だけ（リンクだけの提出は「提出する」でそのまま確定する）
  await page.waitForSelector('m3e-dialog[open] input[type="url"]');
  expectTrue(
    (await page.locator('m3e-dialog[open] input[type="file"]').count()) === 0,
    "Web の提出画面にファイル欄がある",
  );
  await page.fill("m3e-dialog[open] textarea >> nth=0", "公式サイトの初稿（ライブ表示で確認）");
  await page.fill('m3e-dialog[open] input[type="url"]', `${BASE}/demo-site/index.html`);
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出する" }).click();
  await page.waitForURL(/\/v\/\d+$/, { timeout: 15_000 });
  await signInAs("mock-nogiku-reviewer");
  await go(siteWork);
  await page.waitForSelector(".wlive__frame", { timeout: 15_000 });
  // ブリッジの ready（印の層が出る）
  await page.waitForSelector(".wlive__marks", { timeout: 15_000 });
  await page.locator(".wlive__mode m3e-button", { hasText: "コメント" }).click();
  await page.waitForTimeout(400);
  // iframe の中の見出しを押す（縮小表示なので座標ではなく、要素にポインターイベントを送る）
  const site = page.frameLocator(".wlive__frame");
  const clickIn = (selector) =>
    site
      .locator(selector)
      .first()
      .evaluate((el) => {
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        for (const type of ["pointerdown", "pointerup"])
          el.dispatchEvent(
            new PointerEvent(type, {
              ...at,
              button: 0,
              bubbles: true,
              cancelable: true,
              pointerId: 1,
            }),
          );
      });
  await clickIn("#events h2");
  await page.waitForSelector(".compose-pop__place");
  const place = await page.locator(".compose-pop__place").innerText();
  expectTrue(place.includes("iPhone 17（402px）"), `投稿欄に端末と要素が出ない（${place}）`);
  await page.fill(".compose-pop textarea", "見出し「企画一覧」は「企画をさがす」に揃える");
  await page.locator(".compose-pop m3e-button", { hasText: "投稿" }).click();
  await page.waitForSelector(".compose-pop", { state: "detached" });
  await page.waitForFunction(
    () => document.querySelectorAll(".wlive__marks .anchor-pin").length === 1,
    null,
    { timeout: 10_000 },
  );
  // PC 1440 に切り替えても同じ要素に印が付き直る（位置は外れない）
  // 投稿した直後は、ライブ表示の枠が印の位置へスクロールし直すことがある。M3E のメニューはスクロールで閉じるので、
  // 開いたまま残るまで押し直す（落ち着くまでの間に押すと、開いてすぐ閉じる）
  for (let i = 0; i < 4; i++) {
    await page.locator(".wlive__device").click();
    await page.waitForTimeout(500);
    if ((await page.locator("m3e-menu:popover-open").count()) > 0) break;
  }
  await page.locator("m3e-menu-item-radio:visible", { hasText: "PC 1440" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".wlive__marks .anchor-pin").length === 1,
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(600);
  expectTrue(
    (await page.locator('.thread m3e-icon[name="location_off"]').count()) === 0,
    "PC 幅で位置が外れた",
  );
  expectTrue(
    (await page.locator(".thread .thread__index").innerText()).includes("iPhone 17（402px）"),
    "カードに付けたときの端末幅が出ない",
  );
  await shot("68-web-live-comment");
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(800);
  await shot("68b-web-live-mobile");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 69 Figma: 制作者がフレームの URL を貼って取り込み（デモは見本 PNG）、校正者が画像の上にピン → 埋め込み表示でフレームにコメント
  await signInAs("mock-nogiku-creator");
  const figmaWork = await openWork("公式サイト 画面デザイン（Figma）");
  await btn("最初の版を提出").click();
  // Figma の制作物もファイルは出さず、フレームの URL が主な入力（取り込みまで済んだらそのまま確定する）
  await page.waitForSelector('m3e-dialog[open] textarea[placeholder^="https://www.figma.com"]');
  expectTrue(
    (await page.locator('m3e-dialog[open] input[type="file"]').count()) === 0,
    "Figma の提出画面にファイル欄がある",
  );
  await page.fill("m3e-dialog[open] textarea >> nth=1", "ホームのスマホ・PC の画面案");
  await page.fill(
    'm3e-dialog[open] textarea[placeholder^="https://www.figma.com"]',
    "https://www.figma.com/design/AbCdEfGhIjKl/MF100-Web?node-id=12-34\nhttps://www.figma.com/design/AbCdEfGhIjKl/MF100-Web?node-id=56-78",
  );
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出する" }).click();
  await page.waitForURL(/\/v\/1$/, { timeout: 30_000 });
  await signInAs("mock-nogiku-reviewer");
  await go(figmaWork);
  await page.waitForSelector(".origin-bar", { timeout: 15_000 });
  expectTrue(
    (await page.locator(".origin-bar").innerText()).includes("ホーム（スマホ）"),
    "取り込んだ画像に Figma の由来が出ない",
  );
  await page.waitForSelector(".viewer__page img");
  await commentOnRect(0.3, 0.2, 0.7, 0.3, "見出しの帯の色を公式サイトに合わせる");
  await shot("69-figma-import");
  // 埋め込み表示（Figma の URL の添付）に切り替えてフレーム単位でコメント
  await pickArtifact("Figma: https://www.figma.com/design/AbCdEfGhIjKl/MF100-Web?node-id=12-34");
  await page.waitForSelector(".figma-embed__iframe");
  await page.locator("m3e-button", { hasText: "このフレームにコメント" }).click();
  await page.waitForSelector(".compose-pop__place");
  await page.fill(".compose-pop textarea", "このフレーム全体の余白を見直したい");
  await page.locator(".compose-pop m3e-button", { hasText: "投稿" }).click();
  await page.waitForSelector(".compose-pop", { state: "detached" });
  await page.waitForTimeout(500);
  expectTrue(
    (await page
      .locator(".thread", { hasText: "フレーム全体" })
      .locator(".thread__link")
      .count()) === 1,
    "フレームのコメントに「Figma で開く」が無い",
  );
  await shot("69b-figma-embed");
  // 70 アバターを変える（Humation。§56）: アカウントメニュー → 髪型を替え、「色」で髪の色を替えて保存 → 右上のアバターが変わる
  await go("/");
  await page.waitForSelector(".shell__account svg", { timeout: 20_000 });
  const avatarBefore = await page
    .locator(".shell__account svg")
    .first()
    .evaluate((el) => el.outerHTML);
  await page.locator('m3e-icon-button[aria-label^="アカウント"]').click();
  await page.locator("m3e-menu-item", { hasText: "アバターを変える" }).click();
  const picker = page.locator("m3e-dialog.avatar-picker[open]");
  await page.waitForSelector("m3e-dialog.avatar-picker[open] .avatar-part", { timeout: 20_000 });
  await page.waitForTimeout(400);
  // アイコンに映らないボトムスの部位・色は出さない（利用者指示 2026-10-17）。タブは髪型・トップス・小物・めがね・色
  expectTrue(
    (await picker.locator("m3e-tab").count()) === 5,
    "アバターのタブが 5 つ（髪型・トップス・小物・めがね・色）でない",
  );
  // 部品の一覧は 1 つを選ぶ radiogroup。いま選んでいないものを 1 つ選ぶ
  await picker.locator('.avatar-parts [role="radio"][aria-checked="false"]').first().click();
  await page.waitForTimeout(400);
  await shot("70-avatar-picker");
  await picker.locator("m3e-tab", { hasText: "色" }).click();
  await page.waitForSelector("m3e-dialog.avatar-picker[open] .avatar-swatches");
  expectTrue(
    (await picker.locator(".avatar-colors__row").count()) === 5,
    "アバターの色の役割が 5 つ（髪・肌・トップス・線・背景）でない",
  );
  await picker
    .locator(".avatar-colors__row")
    .first()
    .locator('[role="radio"][aria-checked="false"]')
    .nth(2)
    .click();
  await page.waitForTimeout(200);
  await picker.locator('[slot="actions"] m3e-button', { hasText: "保存する" }).click();
  await page.waitForFunction(
    (before) => {
      const svg = document.querySelector(".shell__account svg");
      return Boolean(svg) && svg.outerHTML !== before;
    },
    avatarBefore,
    { timeout: 10_000 },
  );
  await page
    .waitForSelector("m3e-dialog.avatar-picker[open]", { state: "detached", timeout: 10_000 })
    .catch(() => {});
  // 70b compact: アカウントのボトムシート → 全画面のダイアログ（「色」のタブ）
  await page.setViewportSize({ width: 412, height: 915 });
  // compact の配置（アカウントのボトムシート）に切り替わってから押す（切り替わる前に押すと PC のメニューが開いて消える）
  await page.waitForSelector("m3e-bottom-sheet.action-sheet", { timeout: 10_000 });
  await settle();
  await page.locator('m3e-icon-button[aria-label^="アカウント"]').click();
  await page.waitForSelector("m3e-bottom-sheet.action-sheet[open] .list__item", {
    timeout: 10_000,
  });
  await settle(); // ボトムシートが上がり切るまで
  await page.locator("m3e-list-action", { hasText: "アバターを変える" }).click();
  await page.waitForSelector("m3e-dialog.avatar-picker[open] .avatar-part", { timeout: 20_000 });
  await picker.locator("m3e-tab", { hasText: "色" }).click();
  await page.waitForSelector("m3e-dialog.avatar-picker[open] .avatar-swatches");
  await page.waitForTimeout(400);
  await shot("70b-avatar-picker-compact");
  await picker.locator('[slot="actions"] m3e-button', { hasText: "キャンセル" }).click();
  await page.waitForTimeout(400);
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
