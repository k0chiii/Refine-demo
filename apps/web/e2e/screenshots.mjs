/**
 * デモモード（バックエンド無し）で主要画面を一周し、e2e/out/screenshots に PNG を保存する（git 管理外）。
 *   1) pnpm build:demo && pnpm exec vp preview --mode demo --outDir dist-demo --port 4173
 *   2) BASE_URL=http://127.0.0.1:4173 pnpm screenshots
 * Chromium は PLAYWRIGHT_BROWSERS_PATH（または `npx playwright-core install chromium`）で解決する。
 *
 * E2E_PART で流す範囲を選ぶ（既定 all = 全部を順に）。CI は PR で smoke（主要な流れだけ・数分）、main では
 * core / late / compact / v2 / web を別々のジョブで同時に流す（それぞれ新しいデモのデータから始まる。前の部の状態が要るものは
 * その部の頭で用意する）。
 *   smoke   … 01–08（サインイン → 一覧 → 登録 → 版の提出 → 割り当て → 校正 → 紙面にコメント）
 *   core    … 01–79（全体の前半: 一覧・提出・校正・コメント・スレッド）
 *   late    … 27–64（制作・採否・第2版と持ち越し・比較・校了・通知・管理）※ core の続き。core と同じジョブで流す
 *   compact … 30・20・33・26・37・34・39–47（広さごとの画面・スマホ・文章エディタ）
 *   v2      … 50–66（表記ルール・自動校正・SNS・動画）
 *   web     … 67–72（Web のライブ表示・Figma・アバター・原本）
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const PART = process.env.E2E_PART ?? "all";
const OUT = process.env.OUT_DIR ?? resolve(here, "out/screenshots");
const FIXTURES = process.env.FIXTURES_DIR ?? resolve(here, "fixtures");
mkdirSync(OUT, { recursive: true });
/** A11Y=1 で各画面に axe-core（WCAG 2.1 A/AA）を実行し、違反を docs/a11y-report.json に書く（A-15）。 */
const A11Y = process.env.A11Y === "1";
const axeSource = A11Y
  ? readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8")
  : null;
const a11yReport = [];
/** serious / critical の違反は実行を失敗にする。a11yKnown に挙げた既知のものだけ除く */
const a11yBlocking = [];
/** 既知: M3E の日付ピッカーの日のボタンに名前が無い（部品の Shadow DOM の中。docs/a11y-report.json の 21-date-picker） */
const a11yKnown = (screen, id, target) =>
  id === "aria-command-name" &&
  (screen.includes("date-picker") || /m3e-calendar|m3e-month-view/.test(JSON.stringify(target)));
/**
 * 区間計測（どこに時間がかかっているか）。画面ごとに「前の撮影からの操作・待ち」「描画待ち（settle）」「撮影」「axe」「固定待ち」を測り、
 * out/timings-<部>.json に書く。CI では遅い順の上位を実行のまとめ（GITHUB_STEP_SUMMARY）にも出す
 */
const timing = { settle: 0, sleep: 0, scenes: [] };
let sceneStart = performance.now();
let sceneSettle = 0;
let sceneSleep = 0;
const runStart = performance.now();

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
 * スクロールに連動する animation（アプリバーの縁 mf-appbar-edge の animation-timeline: scroll()）は時間では終わらず
 * ずっと running なので、文書の時間軸（document.timeline）で動くものだけを見る。見ないと毎回 3 秒の打ち切りまで待つ
 * （計測 2026-10-22: smoke 251 秒のうち 232 秒がこの待ち）
 */
const settleRaw = () =>
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
              return (
                a.timeline === document.timeline &&
                a.playState === "running" &&
                t &&
                t.iterations !== Infinity
              );
            }),
          );
        };
        const check = () =>
          !busy() || performance.now() > limit ? done() : requestAnimationFrame(check);
        requestAnimationFrame(() => requestAnimationFrame(check));
      }),
  );

const settle = async () => {
  const t0 = performance.now();
  await settleRaw();
  const ms = performance.now() - t0;
  timing.settle += ms;
  sceneSettle += ms;
};
// 固定の待ち（waitForTimeout）も数える。auto-wait に置き換える候補を見つけるため
const rawWaitForTimeout = page.waitForTimeout.bind(page);
page.waitForTimeout = async (ms) => {
  timing.sleep += ms;
  sceneSleep += ms;
  return rawWaitForTimeout(ms);
};

const shot = async (name, scrollTo) => {
  await page.evaluate(async (sel) => {
    window.scrollTo(0, 0);
    if (sel) document.querySelector(sel)?.scrollIntoView({ block: "center" });
    await document.fonts.load('400 24px "Material Symbols Outlined"');
  }, scrollTo ?? null);
  await settle();
  const t0 = performance.now();
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
  const screenshotMs = performance.now() - t0;
  console.log("saved", name);
  let axeMs = 0;
  if (A11Y) {
    const a0 = performance.now();
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
    for (const v of result.violations)
      if (v.impact === "serious" || v.impact === "critical")
        for (const n of v.nodes)
          if (!a11yKnown(name, v.id, n.target))
            a11yBlocking.push(`${name}: ${v.id}(${v.impact}) ${JSON.stringify(n.target)}`);
    console.log(
      `  a11y: ${violations.length} violation(s)`,
      violations.map((v) => `${v.id}(${v.impact}×${v.nodes.length})`).join(" "),
    );
    axeMs = performance.now() - a0;
  }
  const now = performance.now();
  const total = now - sceneStart;
  timing.scenes.push({
    screen: name,
    totalMs: Math.round(total),
    actionMs: Math.round(total - sceneSettle - sceneSleep - screenshotMs - axeMs),
    settleMs: Math.round(sceneSettle),
    sleepMs: Math.round(sceneSleep),
    screenshotMs: Math.round(screenshotMs),
    axeMs: Math.round(axeMs),
  });
  sceneStart = now;
  sceneSettle = 0;
  sceneSleep = 0;
};
const ready = () =>
  page.waitForFunction(() => Boolean(globalThis.__mf100demo && globalThis.__mf100router), null, {
    timeout: 30_000,
  });
// デモのデータはメモリ上にあるため、ページ再読込（page.goto）ではなく SPA 内遷移で移動する
const go = async (path) => {
  const nav = page.evaluate(
    (p) => {
      const [to, q] = p.split("?");
      const search = q ? Object.fromEntries(new URLSearchParams(q)) : undefined;
      return globalThis.__mf100router.navigate(search ? { to, search } : { to });
    },
    path.replace(BASE, ""),
  );
  // 校正画面から別の画面へ移るとき、割当があり校正完了にしていなければ「校正を完了しますか？」が出て移動が止まる（LeaveReviewPrompt）。
  // 移動が済むまで見張り、出たら「あとで」（そのまま移動）で進む。校正完了の確認そのものは専用の検証で見る
  let moved = false;
  const leave = page.locator("m3e-dialog[open]", { hasText: "校正を完了しますか？" });
  const watch = (async () => {
    while (!moved) {
      if (await leave.count()) {
        await leave.locator("m3e-button", { hasText: "あとで" }).click();
        return;
      }
      await page.waitForTimeout(100);
    }
  })();
  try {
    await nav;
  } finally {
    moved = true;
  }
  await watch;
  await settle();
};

// サインイン画面の「ログイン済みなら入口（制作・校正）へ」の効果と競合しないよう、/signin に戻ってからサインインし /queue 到達を待つ
const signInAs = async (sub) => {
  await page.evaluate(() => globalThis.__mf100demo.signOut());
  await go("/signin");
  await page.evaluate(async (s) => {
    await globalThis.__mf100demo.ensureSeeded();
    await globalThis.__mf100demo.signIn(s);
  }, sub);
  // サインイン後は `/` が最後に使った入口（制作・校正）へ振り分ける（初めてなら校正のやり残しで決まる）
  await page.waitForURL((u) => ["/", "/make", "/check"].includes(new URL(u).pathname), {
    timeout: 10_000,
  });
  await settle();
};
const users = async () => page.evaluate(() => globalThis.__mf100demo.users());
const btn = (text) => page.locator("m3e-button", { hasText: text }).first();
/** 制作物一覧の行（「局 › 担当」の入れ子のリストの項目） */
const WORKS_ENTRY = ".works .works-table tbody tr";
/** ユーザー選択 UI（UserPicker）で名前を検索して 1 人選ぶ。scope は picker を含む要素の locator。 */
const pickUser = async (scope, name) => {
  const input = scope.locator(".picker__input").first();
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
/**
 * 自動校正の状態表示が「進行中でも失敗でもない」ところまで待つ（文言ではなく、進捗の部品とエラー表示の有無で見る）。
 * 長い猶予（OCR の学習データの初回の読み込み）は 1 回の実行で 1 度だけ。2 度目（all の 54。別の版なので待ちは省けない）は
 * 学習データがブラウザのキャッシュにあるので短く打ち切る
 */
let ocrWarm = false;
const autoProofreadDone = async (coldTimeout) => {
  await page.waitForFunction(
    () => {
      const s = document.querySelector(".auto-status");
      return Boolean(s) && !s.querySelector("m3e-linear-progress-indicator, .error-text");
    },
    null,
    { timeout: ocrWarm ? 60_000 : coldTimeout },
  );
  ocrWarm = true;
};
/** 添付の切替（下部ツールバーのピンのボタンのメニュー） */
const pickArtifact = async (name) => {
  await page.locator('.ws__toolbar m3e-icon-button[aria-label="コメントの表示"]').click();
  await page
    .locator("#viewer-more-menu m3e-menu-item-radio:visible", { hasText: name })
    .first()
    .click();
  await settle();
};
/** コメントの表示（横に一覧・ピンの高さに並べる・ピンだけ）の切替（下部ツールバーのピンのボタンのメニュー） */
const pickLayout = async (label) => {
  await page.locator('.ws__toolbar m3e-icon-button[aria-label="コメントの表示"]').click();
  await page
    .locator("#viewer-more-menu m3e-menu-item-radio:visible", { hasText: label })
    .first()
    .click();
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
  await page.waitForSelector(".compose-pop .rt__content");
  await page.fill(".compose-pop .rt__content", body);
  await page.locator(".compose-pop .rt__send").click();
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
/**
 * エディタの引き出し（コメント／版／情報）を開く。引き出しが開いているあいだは縦の浮遊ツールバーが隠れる
 * （利用者決定 2026-10-20）ので、開いていれば引き出しのタブで、畳んでいれば縦のツールバーで切り替える
 */
const drawer = async (label) => {
  const bar = page.locator(".ws__side-toolbar");
  if (await bar.isVisible()) {
    await bar.locator(`m3e-icon-button[aria-label^="${label}"]`).click();
  } else {
    const tab = page.locator(".drawer .pane-tabs m3e-tab", { hasText: label }).first();
    if ((await tab.getAttribute("selected")) === null) await tab.click();
  }
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
 * 紙面のふつうのクリックは投稿欄を出さない（利用者指示 2026-10-20）。なぞる（範囲）と長押し（ピン）だけがコメント。
 * 押したまま動かさず待つ（マウスの長押しは 500ms）
 */
const mouseHold = async (x, y, ms = 700) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
};
const stopCompare = async () => {
  await openComparePicker();
  await comparePickItem("比べるのをやめる");
};

/** 部をまたいで使う、core で登録・提出した制作物（公式パンフレット）の URL と校正者 */
let workUrl, reviewer, revisionUrl, revision2Url;

/**
 * compact を単独で流すとき、core と late が作るもの（公式パンフレットの第1版・第2版と校正者）を、撮影なしで手早く用意する。
 * 第1版は添付が複数（37 の添付の切り替えで使う）
 */
async function prepareRevisions() {
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/works`);
  await page.locator(WORKS_ENTRY, { hasText: "MF100 公式パンフレット" }).first().click();
  await page.waitForURL(/\/works\/[^/]+$/);
  workUrl = page.url();
  reviewer = (await users()).find((u) => u.sub === "mock-nogiku-reviewer");
  await submitRevision(
    "最初の版を提出",
    [
      resolve(FIXTURES, "sample.pdf"),
      resolve(FIXTURES, "poster.png"),
      resolve(FIXTURES, "greeting.txt"),
    ],
    "初稿。表紙と地図ページ。",
    async () => {
      for (const id of ["theme_font", "balance", "committee_output"])
        await page.locator(`m3e-dialog[open] m3e-checkbox#self-check-${id}`).click();
    },
  );
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/1$/, { timeout: 15_000 });
  revisionUrl = page.url();
  await pdfReady();
  await drawer("版");
  await submitRevision("新しい版を提出", [resolve(FIXTURES, "sample.pdf")], "第2版。");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/2$/, { timeout: 15_000 });
  revision2Url = page.url();
  await pdfReady();
  // 制作者に通知を 1 件（32 のベル）: 校正者が第2版に位置なしのコメントを付ける
  await signInAs("mock-nogiku-reviewer");
  await go(revision2Url);
  await pdfReady();
  await drawer("コメント");
  await page.getByRole("button", { name: "全体へのコメント" }).click();
  await page.fill(".compose-pop .rt__content", "凡例の文字の大きさを確認してください。");
  await page.locator(".compose-pop .rt__send").click();
  await page.waitForSelector(".compose-pop", { state: "detached" });
}

/** web を単独で流すとき、72 で第3版を出す EVE 企画ポスターに第1版・第2版を用意する（全部を流すときは前の部で出している） */
async function prepareWeb() {
  await signInAs("mock-nogiku-creator");
  await openWork("EVE 企画ポスター");
  await submitRevision("最初の版を提出", [resolve(FIXTURES, "sample.pdf")], "初稿。", async () => {
    for (const id of ["theme_font", "balance", "committee_output"])
      await page.locator(`m3e-dialog[open] m3e-checkbox#self-check-${id}`).click();
  });
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/1$/, { timeout: 15_000 });
  await pdfReady();
  await drawer("版");
  await submitRevision("新しい版を提出", [resolve(FIXTURES, "sample.pdf")], "第2版。");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/2$/, { timeout: 15_000 });
  await pdfReady();
}

async function main() {
  // 01 サインイン
  await page.goto(`${BASE}/signin`);
  await ready();
  await page.locator(`m3e-expansion-panel [slot="header"]`).first().click();
  await shot("01-signin");

  // 02 制作物一覧（制作者）: 1 つの表。02b は制作担当で絞り込み、主管担当順に並べ替えたところ。見出しを押すと並べ替え（aria-sort・URL）
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/works`);
  await page.waitForSelector(WORKS_ENTRY);
  await shot("02-works-list");
  // 絞り込み・並べ替えの振る舞いは specs/works-list.spec.ts で確かめる。ここは撮るだけ
  await page.locator(".works__team--production").click();
  await settle();
  await page
    .locator("#works-production-menu m3e-menu-item-radio", { hasText: "広報局 › デザイン担当" })
    .click();
  await page.waitForURL(/production=/);
  await settle();
  await page.locator(".works__sort").click();
  await settle();
  await page.locator("#works-sort-menu m3e-menu-item-radio", { hasText: "主管担当順" }).click();
  await page.waitForURL(/sort=owner/);
  await settle();
  await shot("02b-works-filtered");
  await go(`${BASE}/works`);
  await page.waitForSelector(WORKS_ENTRY);
  // 見出しの並べ替え: 納期を押すと納期の昇順、もう一度で降順
  await page.locator(".works .works-table .mf-table__th .mf-table__sort").nth(3).click();
  await page.waitForURL(/sort=deadline/);
  await settle();
  await page.locator(".works .works-table .mf-table__th[aria-sort] .mf-table__sort").click();
  await page.waitForURL(/dir=desc/);
  await settle();
  await shot("02c-works-sorted");
  await go(`${BASE}/works`);
  await page.waitForSelector(WORKS_ENTRY);
  // 22 アカウントメニュー（右上のアバター）
  await page.locator('m3e-icon-button[aria-label^="アカウント"]').click();
  await settle();
  await shot("22-account-menu");
  await page.keyboard.press("Escape");
  await settle();
  // 31b レールの FAB「作る」→ メニュー（版を提出・新しく書く）→ 版を提出する制作物を選ぶ（自分が制作者の進行中の制作物を納期順。§36 L-15）
  await page.locator('m3e-nav-rail m3e-fab[aria-label="作る"]').click();
  await page.waitForSelector("#make-menu m3e-menu-item:visible");
  await settle();
  await shot("31c-make-fab-menu");
  await page.locator("#make-menu m3e-menu-item", { hasText: "版を提出" }).click();
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
  workUrl = page.url();
  await page.waitForSelector(".editor__empty");
  await shot("03-editor-empty");

  // 04 版提出（ダイアログ）: ファイル → 専門確認 → 転送 → 検証済み → 確定
  const all = await users();
  reviewer = all.find((u) => u.sub === "mock-nogiku-reviewer");
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
  revisionUrl = page.url();
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
  // 13c 校正者をグループでまとめて加える（利用者指示 2026-10-21）: 候補にグループが出て、選ぶと所属する人のチップが並ぶ。
  // サンプルの「こうせいはん」は校正者と校了者。校了者は外して、校正者だけを割り当てる
  {
    const dialog = page.locator("m3e-dialog[open]");
    const input = dialog.locator(".picker__input").first();
    await input.click();
    await input.fill("こうせい");
    await page
      .getByRole("option", { name: /こうせいはん/ })
      .first()
      .click();
    await settle();
    await shot("13c-assign-group");
    await dialog
      .locator("m3e-input-chip", { hasText: "こうりょう" })
      .locator('[aria-label$="を外す"]')
      .click();
    await settle();
  }
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "保存" }).click();
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

  // 06b 切れ目の無い長い題名の制作物（シード）にも版を出して校正者を割り当てる。スマホの横はみ出しの確認に使う（制作・校正の両方に出る）
  await signInAs("mock-nogiku-creator");
  const longPath = await openWork(LONG_TITLE);
  await submitRevision("最初の版を提出", [resolve(FIXTURES, "sample.pdf")], "初稿");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/1$/, { timeout: 15_000 });
  await pdfReady();
  await signInAs("mock-nogiku-manager");
  await go(longPath);
  await pdfReady();
  await drawer("情報");
  await btn("校正者を割り当てる").click();
  await page.waitForSelector('m3e-dialog[open] input[role="combobox"]');
  await pickUser(page.locator("m3e-dialog[open]"), reviewer.name);
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "保存" }).click();
  await page.waitForSelector("m3e-dialog[open]", { state: "detached" });
  await settle();

  // 07 校正（校正者）: 未着手に割り当てが出る。切り替え（未着手・確認中・完了）と行の操作の印
  await signInAs("mock-nogiku-reviewer");
  await go(`${BASE}/check`);
  await page.waitForSelector(".hub[data-hub='check'] m3e-list-action");
  // 切り替え・行の印・ナビの選択とバッジは specs/assign-reviewer.spec.ts で確かめる。色は制作と同じ青（ティールの上書きが無い）
  expectTrue(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue("--mf-teal").trim() === "",
    ),
    "校正のティールの色が残っている",
  );
  // 制作を開いているあいだもバッジは出る（校正者）
  await go(`${BASE}/make`);
  await page.waitForSelector(".hub[data-hub='make']");
  await page.waitForSelector('m3e-nav-item[data-to="/check"] .badge');
  await go(`${BASE}/check`);
  await page.waitForSelector(".hub[data-hub='check'] m3e-list-action");
  await shot("07-check-reviewer");
  // 専門確認の行は情報タブで開く（専門確認の欄がある）
  await page.locator(".hub .hub-row", { hasText: "専門確認" }).first().click();
  await page.waitForURL(/tab=info/);
  await go(`${BASE}/check`);
  await page.waitForSelector(".hub[data-hub='check'] m3e-list-action");
  // 20c 校正（スマホ）: 同じ校正者で。選択・切り替え・行の操作の印は制作と同じ青。ページは横にはみ出さない
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForSelector("m3e-nav-bar");
  await settle();
  await expectNoOverflow("/check", 412, 915);
  await shot("20c-mobile-check");
  // 20e 360 幅（小さいスマホ）: 長い題名でも右端で切れない
  await expectNoOverflow("/check", 360, 780);
  await shot("20e-mobile-check-360");
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle();
  // 校了する行は未着手の先頭に固まる（校了者で）
  await signInAs("mock-nogiku-approver");
  await go(`${BASE}/check`);
  await page.waitForSelector(".hub[data-hub='check'] m3e-list-action");
  expectTrue(
    ((await page.locator(".hub .hub-row .hub-chip").first().textContent()) ?? "").includes(
      "校了する",
    ),
    "校了する行が未着手の先頭にない",
  );
  // 以降は校正者のまま（元の流れ）
  await signInAs("mock-nogiku-reviewer");
  await go(`${BASE}/check`);
  await page.waitForSelector(".hub[data-hub='check'] m3e-list-action");
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle();
  // （36 RTL は外した。日本語だけのアプリなので RTL には対応しない。利用者決定 2026-10-15・UI_M3E §35 L-16）
  // 29 large（1200 以上）: メニューで標準の展開レール（220）。内容を押す。状態は保存され、既定は折りたたみ
  await railToggle.click();
  await page.waitForFunction(() => document.querySelector("m3e-nav-rail")?.mode === "expanded");
  await settle();
  await shot("29-rail-expanded");
  await railToggle.click();
  await page.waitForFunction(() => document.querySelector("m3e-nav-rail")?.mode === "compact");
  await settle();

  // 08 エディタ: PDF 上でドラッグするとその場に投稿欄が出る（校正の「未着手」の行から）
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
  await page.getByRole("button", { name: "全体へのコメント" }).click();
  await page.fill(
    ".compose-pop .rt__content",
    "地図ページの凡例の文字が小さく、印刷時に読めない可能性があります。",
  );
  await page.locator(".compose-pop .rt__send").click();
  await page.waitForFunction(() => document.querySelectorAll(".thread").length >= 2);
  await page.locator(".thread .thread__body").first().click();
  await shot("08-workspace-comment");
  if (PART === "smoke") return;
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
  // 縦の浮遊ツールバーは右の引き出しが開いているあいだは隠れ、畳むと出る（利用者決定 2026-10-20）。出たツールバーから開き直せる
  {
    const bar = page.locator(".ws__side-toolbar");
    expectTrue(!(await bar.isVisible()), "引き出しが開いているのに縦の浮遊ツールバーが出ている");
    await page.locator(".ws__handle").focus();
    await page.keyboard.press("Enter"); // 畳む
    await settle();
    expectTrue(await bar.isVisible(), "引き出しを畳んでも縦の浮遊ツールバーが出ない");
    await drawer("コメント"); // 縦のツールバーから開き直す
    expectTrue(!(await bar.isVisible()), "引き出しを開き直しても縦の浮遊ツールバーが隠れない");
  }
  // 23 ピンの高さに並べる（Google ドキュメント式） / 24 ピンだけ（Figma 式）
  await pickLayout("ピンの高さに並べる");
  await page.waitForSelector(".gutter .thread");
  await shot("23-layout-aligned");
  await pickLayout("ピンだけ");
  await page.waitForSelector(".thread-pop .thread"); // 選択中のスレッドがピンの横に出る
  await shot("24-layout-pins");
  await pickLayout("横に一覧");
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
  await page.waitForSelector(".compose-pop .rt__content");
  // 「@」で制作物を見られる人をメンション（候補から選ぶ）
  await page.fill(".compose-pop .rt__content", "@五月");
  await page.locator(".mention-list m3e-list-action", { hasText: "さつき めい" }).click();
  await settle(); // 選択後のキャレット移動（requestAnimationFrame）が済む前に打つと文字が前に入り込む
  await page.locator(".compose-pop .rt__content").press("End");
  await page.keyboard.type(
    "「皆さま」が同一段落で 3 回続くので、ここは「各位」に言い換えるか文を分けてください。",
  );
  await page.locator(".compose-pop .rt__send").click();
  await page.waitForSelector(".text-anchor");
  await page.waitForSelector(".thread__body .mention");
  await page.locator(".comments .thread .thread__body").last().click();
  await shot("19-text-range");
  await pickArtifact("sample.pdf");

  // 75 自分のコメントを削除（投稿者のみ）: 位置なしのコメントを 1 件立て、⋮ →「削除」→ 確認で消す。スレッドの数が 1 つ減る
  {
    const count = () => page.locator(".comments .thread").count();
    const n0 = await count();
    await page.getByRole("button", { name: "全体へのコメント" }).click();
    // 19b グループのメンション（利用者指示 2026-10-21）: 「@」に続けて打つと、名前が当たるグループが人より先に出る。
    // 選ぶと「@グループ名」が入り、所属する人（見られる人）に知らせる。本文の「@グループ名」も強調する
    await page.fill(".compose-pop .rt__content", "@こうせい");
    const group = page.locator(".mention-list m3e-list-action", { hasText: "こうせいはん" });
    await group.waitFor();
    expectTrue(
      (await group.textContent()).includes("グループ"),
      "メンションの候補にグループの印が無い",
    );
    await shot("19b-mention-group");
    await group.click();
    await settle();
    await page.locator(".compose-pop .rt__content").press("End");
    await page.keyboard.type("削除の確認用のコメントです。");
    await page.locator(".compose-pop .rt__send").click();
    await page.waitForSelector(".comments .thread .mention >> text=@こうせいはん");
    await page.waitForFunction(
      (n) => document.querySelectorAll(".comments .thread").length > n,
      n0,
    );
    const mine = page.locator(".comments .thread", { hasText: "削除の確認用" });
    const panel = await openPanel(mine);
    await panel.locator('.thread-panel__bar m3e-icon-button[aria-label="その他の操作"]').click();
    await settle();
    await page.locator("m3e-menu-item:visible", { hasText: "削除" }).click();
    await page.waitForSelector("m3e-dialog[open] .thread__confirm-delete");
    await settle();
    await shot("75-comment-delete-confirm");
    await page.locator("m3e-dialog[open] .thread__confirm-delete").click();
    await page.waitForSelector(".thread-panel", { state: "detached" });
    await page.waitForFunction(
      (n) => document.querySelectorAll(".comments .thread").length === n,
      n0,
    );
    expectTrue((await count()) === n0, "削除したコメントが一覧から消えない");
  }

  // 76 コメントの書式（Markdown）: 太字と URL と箇条書きを書いて投稿 → カードに strong・a・li が出る（HTML は作らず、リンクは安全な属性つき）。
  // 返信は `コード`、訂正は元の本文を読み込んで追記し、本文の後ろに「編集済み」の印が付く（原文は流れに出さない）。生の HTML は文字のまま出る
  {
    const n0 = await page.locator(".comments .thread").count();
    await page.getByRole("button", { name: "全体へのコメント" }).click();
    await page.waitForSelector(".compose-pop .rt__content");
    await page.locator(".compose-pop .rt__content").click();
    // 入力規則は打ちながら効く: **太字**・URL の自動リンク・「- 」の箇条書き
    await page.keyboard.type("**太字**の確認です https://example.com/proof を見てください ");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- 一つ目");
    await page.keyboard.press("Enter");
    await page.keyboard.type("二つ目");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("<script>alert(1)</script>");
    // 書式のツールバーは本文の上に既定で出ている（7 つのボタン）。「Aa」で隠せる
    await page.locator(".compose-pop .rt__toolbar").waitFor();
    expectTrue(
      (await page.locator(".compose-pop .rt__toolbar m3e-icon-button").count()) === 7,
      "書式のツールバーのボタンが 7 つでない",
    );
    expectTrue(
      (await page.locator(".compose-pop .rt__content strong").count()) === 1 &&
        (await page.locator(".compose-pop .rt__content a").count()) === 1 &&
        (await page.locator(".compose-pop .rt__content li").count()) === 2,
      "入力欄で太字・リンク・箇条書きにならない",
    );
    await shot("76-comment-markdown-compose");
    await page.locator(".compose-pop .rt__send").click();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".comments .thread").length > n,
      n0,
    );
    const card = page.locator(".comments .thread", { hasText: "太字" });
    await card.locator(".thread__body strong").waitFor();
    expectTrue((await card.locator(".thread__body strong").count()) === 1, "strong が無い");
    const link = card.locator('.thread__body a[href^="https://"]');
    expectTrue((await link.count()) === 1, "https のリンクが無い");
    expectTrue(
      (await link.getAttribute("rel")) === "noopener noreferrer nofollow" &&
        (await link.getAttribute("target")) === "_blank",
      "リンクの rel / target が違う",
    );
    expectTrue((await card.locator(".thread__body li").count()) === 2, "箇条書きが 2 件でない");
    expectTrue(
      (await card.locator(".thread__body script").count()) === 0 &&
        ((await card.locator(".thread__body").innerText()) ?? "").includes("<script>"),
      "生の HTML が文字のまま出ていない",
    );
    // 一覧のカードは本文を 3 行までに縮めて見せる（全文はスレッドのパネルで）
    const clamp = await card
      .locator(".thread__body--clamp")
      .evaluate((el) => getComputedStyle(el).webkitLineClamp);
    expectTrue(clamp === "3", "一覧のカードの本文が 3 行までに縮められていない");
    const panel = await openPanel(card);
    // 返信（`コード`）
    await panel.locator(".thread-panel__composer .rt__content").click();
    await page.keyboard.type("`inline` で返信");
    await panel.locator(".thread-panel__composer .rt__send").click();
    await panel.locator(".thread__replybody code").waitFor();
    // 訂正: 本文を読み込んで追記する
    await panel.locator('.thread-panel__bar m3e-icon-button[aria-label="その他の操作"]').click();
    await settle();
    await page.locator("m3e-menu-item:visible", { hasText: "訂正" }).click();
    await panel.locator(".thread-panel__root .thread__form .rt__content").waitFor();
    // メニューから開いても、入力欄にフォーカスが移る（メニューが閉じてボタンへ戻したあとで）
    await page.waitForFunction(() =>
      Boolean(document.activeElement?.closest(".thread-panel__root .thread__form .rt")),
    );
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" 追記");
    await panel.locator("m3e-button", { hasText: "訂正を保存" }).click();
    await page.waitForSelector(".thread-panel__root .thread__edited");
    await page
      .waitForFunction(
        () =>
          document.querySelector(".thread-panel__root .thread__body")?.textContent.includes("追記"),
        null,
        { timeout: 10_000 },
      )
      .catch(() => {
        throw new Error("訂正が本文に反映されない");
      });
    await shot("76-comment-markdown");
    // 後片付け: 書式のコメントを削除して件数を戻す
    await deleteFromPanel(panel);
    await page.waitForFunction(
      (n) => document.querySelectorAll(".comments .thread").length === n,
      n0,
    );
  }

  // 77 コメント・返信の添付（利用者指示 2026-10-20）: 新しいコメントに画像を添付して投稿 → カードにサムネイル。
  // 返信にも画像を添付 → 返信にサムネイル。取り除く操作・送信中は投稿できない
  {
    const n0 = await page.locator(".comments .thread").count();
    await page.getByRole("button", { name: "全体へのコメント" }).click();
    await page.waitForSelector(".compose-pop .rt__content");
    await page.fill(".compose-pop .rt__content", "添付の確認用のコメントです。");
    await page.setInputFiles(".compose-pop input[type=file]", [pngFile("shot-a.png", 1)]);
    await page.waitForSelector(".compose-pop .cmt-pending__item");
    // 圧縮・送信が済むと丸い進み具合が消えてサムネイルになる
    await page.waitForFunction(
      () =>
        document.querySelector(".compose-pop .cmt-pending__thumb img") &&
        !document.querySelector(".compose-pop .cmt-pending__progress"),
      null,
      { timeout: 20_000 },
    );
    await shot("77-comment-attach-compose");
    await page.locator(".compose-pop .rt__send").click();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".comments .thread").length > n,
      n0,
    );
    const card = page.locator(".comments .thread", { hasText: "添付の確認用" });
    // サムネイルは画面に入ったものだけ取りに行く。新しいコメントは一覧の末尾なので、見える位置へ送る
    await card.scrollIntoViewIfNeeded();
    await card.locator(".cmt-files__tile img").waitFor({ timeout: 15_000 });
    expectTrue(
      await card
        .locator(".cmt-files__tile img")
        .first()
        .evaluate((img) => img.naturalWidth > 0),
      "コメントの添付のサムネイルが描かれない",
    );
    // 一覧のカードには添付の小さなサムネイルが並ぶ
    expectTrue(
      await card
        .locator(".cmt-files--thumbs .cmt-files__tile img")
        .first()
        .evaluate((img) => img.naturalWidth > 0),
      "一覧のカードにサムネイルが並ばない",
    );
    // 返信に画像を添付（本文は空でも送れる）: スレッドのパネルの返信欄で
    const panel = await openPanel(card);
    await panel.locator(".thread-panel__composer .rt__content").click();
    await panel
      .locator(".thread-panel__composer input[type=file]")
      .setInputFiles([pngFile("shot-b.png", 2)]);
    await panel
      .locator(".thread-panel__composer .cmt-pending__thumb img")
      .waitFor({ timeout: 20_000 });
    await page.waitForFunction(
      () => !document.querySelector(".thread-panel__composer .cmt-pending__progress"),
    );
    await panel.locator(".thread-panel__composer .rt__send").click();
    await panel.locator(".thread__replyitem .cmt-files__tile img").waitFor({ timeout: 15_000 });
    expectTrue(
      await panel
        .locator(".thread__replyitem .cmt-files__tile img")
        .first()
        .evaluate((img) => img.naturalWidth > 0),
      "返信の添付のサムネイルが描かれない",
    );
    expectTrue(
      await panel
        .locator(".thread-panel__root .cmt-files__tile img")
        .first()
        .evaluate((img) => img.naturalWidth > 0),
      "スレッドのパネルの本文の添付のサムネイルが描かれない",
    );
    await shot("77-comment-attach");
    // 後片付け: コメントを削除して件数を戻す
    await deleteFromPanel(panel);
    await page.waitForFunction(
      (n) => document.querySelectorAll(".comments .thread").length === n,
      n0,
    );
  }

  // 78 スレッドのパネル（利用者決定 2026-10-20「Slackみたいに別タブで開く感じ？横に開く感じ？」）: 一覧のカードの「返信」の行を押すと、
  // スレッドが一覧を差し替えて開く（引き出しは広げない。§104）。元のコメントの下に返信の流れ、一番下に返信欄。
  // 同じ人が続けて書いた返信はまとめる。79 別の人には未読の点が付き、開くと消え、「ここから未読」の線が引かれる
  {
    const n0 = await page.locator(".comments .thread").count();
    await page.getByRole("button", { name: "全体へのコメント" }).click();
    await page.waitForSelector(".compose-pop .rt__content");
    await page.fill(
      ".compose-pop .rt__content",
      "スレッドの確認用です。縦に長くなる議論もここで続けます。",
    );
    await page.locator(".compose-pop .rt__send").click();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".comments .thread").length > n,
      n0,
    );
    const card = page.locator(".comments .thread", { hasText: "スレッドの確認用" });
    // 自分の投稿は自分には未読にならない
    expectTrue((await card.locator(".thread__unread").count()) === 0, "自分の投稿が未読になる");
    // カードを押すだけではパネルは開かない
    await card.locator(".thread__body").click();
    await settle();
    expectTrue(
      (await page.locator(".thread-panel").count()) === 0,
      "カードを押しただけでパネルが開く",
    );
    const drawerWidth = () =>
      page.evaluate(() => document.querySelector(".comments").getBoundingClientRect().width);
    const widthBefore = await drawerWidth();
    const panel = await openPanel(card);
    // 広い画面でも引き出しは広げず、スレッドが一覧を差し替える（§104）
    const sides = await page.evaluate(() => {
      const list = document.querySelector(".comments__main").getBoundingClientRect();
      const panel = document.querySelector(".thread-panel").getBoundingClientRect();
      const composer = document.querySelector(".thread-panel__composer").getBoundingClientRect();
      return {
        overList: Math.abs(panel.left - list.left) <= 1 && Math.abs(panel.width - list.width) <= 1,
        listVisible: getComputedStyle(document.querySelector(".comments__main")).visibility,
        composerInside: composer.bottom <= innerHeight && composer.top >= panel.top,
      };
    });
    expectTrue((await drawerWidth()) === widthBefore, "スレッドを開くと引き出しが広がる");
    expectTrue(
      sides.overList && sides.listVisible === "hidden",
      "広い画面でスレッドが一覧を差し替えない",
    );
    expectTrue(sides.composerInside, "返信欄が見えていない");
    for (const text of ["一件目の返信です。", "続けて書いた返信です。"]) {
      await panel.locator(".thread-panel__composer .rt__content").click();
      await page.keyboard.type(text);
      await panel.locator(".thread-panel__composer .rt__send").click();
      await page.waitForFunction(
        (t) =>
          [...document.querySelectorAll(".thread-panel .thread__replybody")].some((e) =>
            e.textContent.includes(t),
          ),
        text,
      );
    }
    // 同じ人が 5 分以内に続けた返信は、名前・アバターを省いてまとめる
    expectTrue(
      (await panel.locator(".cth-post--continued").count()) === 1 &&
        (await panel.locator(".cth-post").count()) === 2,
      "続けての返信がまとまらない",
    );
    // 一覧のカードにも、返信が済んだあとに返信の本文が届く（元のコメントの下に、古い順）
    await page.waitForFunction(
      () => {
        const c = [...document.querySelectorAll(".comments .thread")].find((x) =>
          x.textContent.includes("スレッドの確認用"),
        );
        const rows = [...(c?.querySelectorAll(".thread__reply") ?? [])];
        return (
          rows.length === 2 &&
          rows[0].textContent.includes("一件目の返信です。") &&
          rows[1].textContent.includes("続けて書いた返信です。")
        );
      },
      null,
      { timeout: 10_000 },
    );
    await shot("78-thread-panel");
    // 一覧へ戻り、いま返信したスレッドのカード（下の行まで）が見える位置にして撮る
    await closePanel();
    await card.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
    await shot("78c-thread-card-replies");
    // 79 別の人（制作者）: 一覧のカードに未読の点 → パネルを開くと点が消え、「ここから未読」の線が引かれる
    await signInAs("mock-nogiku-creator");
    await go(revisionUrl);
    await pdfReady();
    await drawer("コメント");
    const theirs = page.locator(".comments .thread", { hasText: "スレッドの確認用" });
    await theirs.waitFor();
    expectTrue(
      (await theirs.locator(".thread__unread").count()) === 1,
      "別の人に未読の点が付かない",
    );
    await theirs.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
    await shot("79-thread-unread");
    const theirPanel = await openPanel(theirs);
    await theirPanel.locator(".cth-unread").waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".comments .thread")]
        .filter((c) => c.textContent.includes("スレッドの確認用"))
        .every((c) => !c.querySelector(".thread__unread")),
    );
    await shot("79-thread-read");
    await theirPanel.locator(".thread-panel__composer .rt__content").click();
    await page.keyboard.type("確認しました。対応します。");
    await theirPanel.locator(".thread-panel__composer .rt__send").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".thread-panel .cth-post").length === 3,
    );
    await closePanel();
    // 元の投稿者に戻ると、制作者の返信で未読の点が付き、開くと消える。後片付けでスレッドを削除する
    await signInAs("mock-nogiku-reviewer");
    await go(revisionUrl);
    await pdfReady();
    await drawer("コメント");
    const back = page.locator(".comments .thread", { hasText: "スレッドの確認用" });
    await back.waitFor();
    expectTrue(
      (await back.locator(".thread__unread").count()) === 1,
      "返信が付いたのに未読の点が付かない",
    );
    // 返信（最新の 3 件まで）がカードに並び、制作者の返信の本文も見える
    expectTrue(
      (await back.locator(".thread__reply").count()) === 3 &&
        (await back
          .locator(".thread__reply", { hasText: "確認しました。対応します。" })
          .count()) === 1,
      "返信がカードに並ばない",
    );
    await back.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
    await shot("79-thread-unread-reply");
    // 78b スマホ（同じ人・まだ開いていない）: シートを開くと未読の点。カードの「返信」の行を押すと、スレッドがシートいっぱいに開く
    // （一覧を置き換える。戻るで一覧へ）。返信欄は一番下に見えたまま。開くと未読の点は消える
    await page.setViewportSize({ width: 412, height: 915 });
    await settle();
    await page.locator('.ws__toolbar m3e-icon-button[aria-label^="コメント（"]').click();
    await settle();
    const mobileCard = page.locator("m3e-bottom-sheet.ws__sheet .thread", {
      hasText: "スレッドの確認用",
    });
    await mobileCard.waitFor();
    expectTrue(
      (await mobileCard.locator(".thread__unread").count()) === 1,
      "スマホのカードに未読の点が付かない",
    );
    expectTrue(
      (await mobileCard.locator(".thread__reply").count()) === 3,
      "スマホのカードに返信が並ばない",
    );
    await mobileCard.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
    await shot("78d-mobile-thread-card-replies");
    await openPanel(mobileCard);
    {
      const m = await page.evaluate(() => {
        const sh = document.querySelector("m3e-bottom-sheet.ws__sheet").getBoundingClientRect();
        const panel = document.querySelector(".thread-panel").getBoundingClientRect();
        const composer = document.querySelector(".thread-panel__composer").getBoundingClientRect();
        return {
          sheetHeight: sh.height,
          panelHeight: panel.height,
          composerBottom: composer.bottom,
          innerHeight,
          listShown: getComputedStyle(document.querySelector(".comments__main")).display,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      console.log("mobile thread panel:", JSON.stringify(m));
      expectTrue(m.listShown === "none", "スマホのスレッドが一覧を置き換えない");
      expectTrue(m.panelHeight >= m.sheetHeight * 0.8, "スレッドがシートいっぱいに開かない");
      expectTrue(m.composerBottom <= m.innerHeight + 1, "スマホで返信欄が画面の下に隠れる");
      expectTrue(m.pageOverflow <= 0, "スマホでスレッドが横にはみ出す");
    }
    await shot("78b-mobile-thread-panel");
    await closePanel();
    await page.waitForSelector("m3e-bottom-sheet.ws__sheet .comments__list");
    await page.waitForFunction(() =>
      [...document.querySelectorAll("m3e-bottom-sheet.ws__sheet .thread")]
        .filter((c) => c.textContent.includes("スレッドの確認用"))
        .every((c) => !c.querySelector(".thread__unread")),
    );
    await page.evaluate(() => document.querySelector("m3e-bottom-sheet.ws__sheet").hide());
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle();
    const backPanel = await openPanel(back);
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".comments .thread")]
        .filter((c) => c.textContent.includes("スレッドの確認用"))
        .every((c) => !c.querySelector(".thread__unread")),
    );
    await deleteFromPanel(backPanel);
    await page.waitForFunction(
      (n) => document.querySelectorAll(".comments .thread").length === n,
      n0,
    );
  }

  if (PART === "all" || PART === "core") await lateScenes();
}

/** 27–64: 制作・採否・第2版と持ち越し・比較・校了・通知・管理（core の続き。core で付けたコメント・版を使う） */
async function lateScenes() {
  // 27 制作（制作者）: 進行中の「あなたの番」（版を提出・対応する）と「校正中」。行ごとに次の操作の印が 1 つ
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/make`);
  await page.waitForSelector(".hub[data-hub='make'] m3e-list-action");
  expectTrue(
    (await page.locator(".hub .hub__tabs m3e-button").count()) === 3,
    "制作の切り替えが 3 つでない",
  );
  expectTrue(
    (await page.locator(".hub .hub-row").count()) ===
      (await page.locator(".hub .hub-row .hub-chip").count()),
    "制作の行に次の操作の印が 1 つずつ付いていない",
  );
  expectTrue(
    await page.evaluate(
      () => document.querySelector('m3e-nav-item[data-to="/make"]')?.selected === true,
    ),
    "制作を開いているのにナビの「制作」が選択されていない",
  );
  await shot("27-make-creator");
  // 27c 制作の下書き・校了済みの切り替え
  await page.locator(".hub .hub__tabs m3e-button", { hasText: "下書き" }).click();
  await page.waitForFunction(() => location.search.includes("show=draft"));
  await settle();
  await shot("27c-make-drafts");
  await page.locator(".hub .hub__tabs m3e-button", { hasText: "進行中" }).click();
  await settle();
  // 27b 制作物の先頭の「制作物の状況」（§74）: 数字のカード 3 枚・状態の積み上げ棒と凡例 5 段階。数・構造だけを見る（文言は見ない）
  await go(`${BASE}/works`);
  await page.waitForSelector(".ov");
  // 「制作物の状況」は既定で閉じ、開け閉めを覚える（localStorage。監査 W-01）
  expectTrue(
    (await page.locator(".ov").getAttribute("open")) === null,
    "制作物の状況が既定で閉じていない",
  );
  await page.locator(".ov [slot=header]").click();
  await page.waitForSelector(".ov .legend__item", { state: "visible" });
  expectTrue(
    (await page.evaluate(() => localStorage.getItem("mf100.works-overview-open"))) === "1",
    "制作物の状況を開いたことが覚えられていない",
  );
  expectTrue(
    (await page.locator(".ov .kpis .kpi").count()) === 3,
    "状況の数字のカードが 3 枚でない",
  );
  // 凡例は 0 件の段階を出さない（棒の区間と同じ数）
  expectTrue(
    (await page.locator(".ov .legend__item").count()) ===
      (await page.locator(".ov .stagebar__seg").count()),
    "状態の凡例が棒の区間と合っていない（0 件の段階が残っている）",
  );
  expectTrue(
    (await page.locator(".ov .stagebar__seg").count()) >= 1,
    "状態の積み上げ棒に区間がない",
  );
  await shot("27b-works-overview", ".ov");
  await page.evaluate(() => localStorage.removeItem("mf100.works-overview-open"));

  // 09 採否判断（制作者）: ⋮ → 不採用（理由）
  await go(revisionUrl);
  await page.waitForSelector(".comments .thread");
  const first = page.locator(".comments .thread").first();
  const decisionPanel = await openPanel(first);
  await decisionPanel
    .locator('.thread-panel__bar m3e-icon-button[aria-label="その他の操作"]')
    .click();
  await settle();
  await page.locator("m3e-menu-item:visible", { hasText: "不採用" }).click();
  await page.fill(
    ".thread-panel textarea",
    "正式名称は「五月祭常任委員会」で正しいことを規約で確認済み",
  );
  await decisionPanel.locator("m3e-button", { hasText: "不採用にする" }).click();
  // 一覧はパネルの下に隠れているので、パネルが閉じた（不採用の）状態になるのを待つ
  await page.waitForSelector(".thread-panel.thread--closed");
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
  revision2Url = page.url();
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
    await page.waitForSelector(".compose-pop .rt__content");
    await page.fill(
      ".compose-pop .rt__content",
      "第1版より凡例が小さくなっています。8pt 以上に戻してください。",
    );
    await shot("38-compare-comment");
    const pins = () => page.locator(".compare__pane").last().locator(".anchor-pin").count();
    const before = await pins();
    await page.locator(".compose-pop .rt__send").click();
    await page.waitForSelector(".compose-pop", { state: "detached" });
    await page.waitForFunction(
      (n) => document.querySelectorAll(".compare__pane:last-child .anchor-pin").length > n,
      before,
      { timeout: 10_000 },
    );
  }

  // 64a・73 書き込みのモードは無い（利用者指示 2026-10-20）。PC: クリックはふつうのクリック（PDF のリンクを辿れる）、
  //    なぞる（範囲）と長押し（ピン）だけがコメント。ツールバーの「コメントを追加」は次の 1 回だけ。
  //    第2版は受付中なので、校正者は書き込める（比べているところから戻って）
  await stopCompare();
  await page.waitForFunction(() => document.querySelectorAll(".compare__pane").length === 0);
  await pdfReady();
  await settle();
  expectTrue(
    (await page.locator(".ws__mark-mode, #mark-mode-menu").count()) === 0,
    "書き込みのモードの入口が残っている",
  );
  await shot("64a-viewer-toolbar");
  await context.route("https://example.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>リンク先</title>" }),
  );
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
  const page1 = () => page.locator('.viewer__page[data-page="1"]');
  const composeCount = () => page.locator(".compose-pop").count();
  const cancelCompose = async () => {
    await page.locator('.compose-pop m3e-icon-button[aria-label="キャンセル"]').click();
    await page.waitForSelector(".compose-pop", { state: "detached" });
  };
  // 外部リンクは、ふつうのクリックで新しいタブに開く（投稿欄は出ない）
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
    expectTrue((await composeCount()) === 0, "リンクをクリックしただけで投稿欄が出た");
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
  expectTrue((await composeCount()) === 0, "ページ内リンクをクリックしただけで投稿欄が出た");
  await page.locator('.viewer__page[data-page="1"]').scrollIntoViewIfNeeded();
  await settle();
  // 紙面のふつうのクリックでは投稿欄が出ない。なぞる（範囲）と長押し（ピン）で出る
  {
    const box = await page1().boundingBox();
    const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
    // 下端は浮いたツールバーと重なるので、紙面の中ほどで試す
    await page.mouse.click(...at(0.92, 0.6));
    await page.waitForTimeout(500);
    expectTrue((await composeCount()) === 0, "紙面をクリックしただけで投稿欄が出た");
    const [jx, jy] = at(0.9, 0.55);
    await page.mouse.move(jx, jy);
    await page.mouse.down();
    await page.mouse.move(jx + 2, jy + 2, { steps: 2 }); // しきい値（4px）より小さいぶれはクリック
    await page.mouse.up();
    await page.waitForTimeout(400);
    expectTrue((await composeCount()) === 0, "わずかなぶれでコメントになった");
    await page.mouse.move(...at(0.2, 0.2));
    await page.mouse.down();
    await page.mouse.move(...at(0.5, 0.3), { steps: 6 });
    await page.mouse.up();
    await page.waitForSelector(".compose-pop");
    expectTrue(
      (await page1().locator(".viewer__overlay .anchor-draft").count()) === 1,
      "なぞった範囲が下書きとして描かれない",
    );
    await cancelCompose();
    await mouseHold(...at(0.92, 0.6));
    await page.waitForSelector(".compose-pop");
    expectTrue(
      (await page1().locator(".viewer__overlay circle.anchor-draft").count()) === 1,
      "長押しでピンが置かれない",
    );
    await cancelCompose();
  }
  // コメントの印を隠す: 紙面の印（ピン・範囲）が消え、戻すと出る。コメントの一覧は残る。カードを押すと印が戻る
  {
    await drawer("コメント");
    const marks = () => page.locator(".viewer__overlay [data-anchor]").count();
    const shown = await marks();
    expectTrue(shown > 0, "印を隠す前に、紙面に印が無い");
    const cards = await page.locator(".comments .thread").count();
    const toggle = page.locator(".ws__toolbar .ws__marks-toggle");
    await toggle.click();
    await page.waitForFunction(
      () => document.querySelectorAll(".viewer__overlay [data-anchor]").length === 0,
    );
    expectTrue(
      (await page.locator(".comments .thread").count()) === cards,
      "印を隠したのにコメントの一覧まで隠れた",
    );
    await shot("73b-marks-hidden");
    await toggle.click();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".viewer__overlay [data-anchor]").length === n,
      shown,
    );
    await toggle.click();
    await page.waitForFunction(
      () => document.querySelectorAll(".viewer__overlay [data-anchor]").length === 0,
    );
    await page.locator(".comments .thread .thread__body").first().click();
    await page.waitForFunction(
      () => document.querySelectorAll(".viewer__overlay [data-anchor]").length > 0,
    );
    expectTrue(
      (await page.locator(".ws__toolbar .ws__marks-toggle[selected]").count()) === 0,
      "カードを押して印が戻っても、隠すボタンが押された状態のまま",
    );
  }

  // 持ち越したコメントと比較中のコメントを ✓ で反映済みにする（未解決が残ると理由なしでは校了できない。制作者）
  await signInAs("mock-nogiku-creator");
  await go(revision2Url);
  await pdfReady();
  await drawer("コメント");
  for (let i = 0; i < 5; i++) {
    const sel = '.comments .thread m3e-icon-button[aria-label="反映する"]';
    const left = await page.locator(sel).count();
    if (left === 0) break;
    await page.locator(".comments .thread .thread__body").first().click();
    await page.locator(sel).first().click();
    await page.waitForFunction(([s, n]) => document.querySelectorAll(s).length < n, [sel, left]);
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
  // 62 FB はコメントへ統合して撤去した（docs/UI_M3E.md §95）: ナビは 制作 · 校正 · 制作物 の 3 つだけで、旧 FB の URL は転送される
  {
    const main = page.locator("m3e-nav-rail m3e-nav-item:not(.rail__lower)");
    expectTrue(
      JSON.stringify(await main.evaluateAll((els) => els.map((e) => e.dataset.to))) ===
        JSON.stringify(["/make", "/check", "/works"]),
      "ナビの主な項目が 制作・校正・制作物 の 3 つでない",
    );
    expectTrue(
      (await page.locator("m3e-nav-item", { hasText: "フィードバック" }).count()) === 0,
      "ナビに FB の項目が残っている",
    );
    const workId = new URL(revisionUrl).pathname.split("/")[2];
    await go(`${BASE}/feedback`);
    await page.waitForURL(/\/works$/);
    await go(`${BASE}/feedback/w/${workId}`);
    await page.waitForURL(new RegExp(`/works/${workId}(/|$)`));
    // 移していない（見つからない）旧 FB のスレッドは制作物の一覧へ
    await go(`${BASE}/feedback/no-such-thread`);
    await page.waitForURL(/\/works$/, { timeout: 15_000 });
    await page.waitForSelector(WORKS_ENTRY);
  }

  // 64 エディタに FB の入口は無い
  await signInAs("mock-nogiku-reviewer");
  await go(revision2Url);
  await pdfReady();
  await settle();
  expectTrue(
    (await page.locator('.ws__side-toolbar m3e-icon-button[aria-label^="FB"]').count()) === 0,
    "エディタの縦のツールバーに FB の入口が残っている",
  );
  expectTrue(
    (await page.locator(".drawer m3e-tab, .ws__drawer m3e-tab", { hasText: "FB" }).count()) === 0,
    "エディタの引き出しに FB のタブが残っている",
  );

  if (PART === "all") await compactScenes();
}

/** 30・20・33・26・37・34・39–47: 広さごとの画面・スマホ・文章エディタ */
async function compactScenes() {
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

  // 20 compact（<600）: 制作（1 列のリスト。下部ナビ: 制作・校正・制作物の 3 つ）。
  // 制作者で撮り、右下（下部ナビの上 16）の FAB「作る」も写す / 32 アプリバーのベル（アカウントの隣）→ ボトムシート
  await page.setViewportSize({ width: 412, height: 915 });
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/make`);
  await page.waitForSelector("m3e-nav-bar");
  await page.waitForSelector(".submit-fab m3e-fab");
  expectTrue(
    (await page.locator("m3e-nav-bar m3e-nav-item").count()) === 3,
    "下部ナビが 3 項目でない",
  );
  await settle();
  await shot("20-mobile-make");
  await expectNoOverflow("/make", 412, 915);
  await expectNoOverflow("/make", 360, 780);
  await page.setViewportSize({ width: 412, height: 915 });
  await go(`${BASE}/make`);
  await page.waitForSelector(".submit-fab m3e-fab");
  await settle();
  // FAB「作る」→ ボトムシート（版を提出・新しく書く）
  await page.locator(".submit-fab m3e-fab").click();
  await page.waitForSelector("m3e-bottom-sheet[open] m3e-list-action");
  await settle();
  await shot("20d-mobile-make-fab");
  await page.keyboard.press("Escape");
  await settle();
  await signInAs("mock-nogiku-creator");
  await go(`${BASE}/works`);
  await page.waitForSelector(".ov");
  await page.evaluate(() => document.querySelector(".ov")?.setAttribute("open", ""));
  await settle();
  await shot("20b-mobile-works-overview", ".ov");
  await page.locator(".shell__appbar .bell m3e-icon-button").click();
  await page.waitForSelector("m3e-bottom-sheet.notif-sheet .notif");
  await settle();
  await shot("32-mobile-notifications");
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.notif-sheet").hide());
  await settle();
  // 33 compact の制作物一覧（リストは端から端まで、題名の左端 16 と揃う。FAB は制作だけ）
  await go(`${BASE}/works`);
  await page.waitForSelector(WORKS_ENTRY);
  expectTrue(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
    "compact の制作物一覧がページごと横にはみ出している",
  );
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
  await page.locator('.ws__toolbar m3e-icon-button[aria-label^="コメント（"]').click();
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
  // 開いている間はシートがツールバーに重なる（中のタブで切り替え、下に払うと閉じる）
  await page.evaluate(() => document.querySelector("m3e-bottom-sheet.ws__sheet").hide());
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
  // 39a レールの FAB「作る」→「新しく書く」: 書ける担当の制作物を選ぶ（最近書いた下書きが上）→ 選ぶとエディタへ
  await page.locator('m3e-nav-rail m3e-fab[aria-label="作る"]').click();
  await page.locator("#make-menu m3e-menu-item", { hasText: "新しく書く" }).click();
  await page.waitForURL(/\/write$/);
  await page.waitForSelector(".write-picker m3e-list-action");
  const firstPick = await page.locator(".write-picker m3e-list-action").first().innerText();
  expectTrue(
    firstPick.includes("公式サイト トップページ"),
    `新しく書く: 最近書いた下書きが上に出ない（${firstPick}）`,
  );
  await shot("39a-write-picker");
  await page.locator(".write-picker m3e-list-action").first().click();
  await page.waitForSelector(".doc[contenteditable=true]");
  expectTrue(
    await page.evaluate(
      () => document.querySelector('m3e-nav-item[data-to="/make"]')?.selected === true,
    ),
    "文章エディタを開いているのにレールの「制作」が選択されていない",
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
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "保存" }).click();
  await page.waitForSelector("m3e-dialog[open]", { state: "detached" });
  // 43 校正（校正者）: 書式付きのまま表示され、文字を選ぶとその場に投稿欄
  await signInAs("mock-nogiku-reviewer");
  await go(writeWorkUrl);
  await page.waitForSelector(".ws__toolbar .ws__marks-toggle");
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
  await page.waitForSelector(".compose-pop .rt__content");
  // マウスで選んだ文字は、投稿欄に文字カーソルを移さず、選択も残る（そのまま Ctrl/⌘＋C でコピーできる）
  await page.waitForTimeout(600);
  const keep = await page.evaluate(() => ({
    inPop: !!document.activeElement?.closest(".compose-pop"),
    selected: getSelection().toString(),
  }));
  expectTrue(
    !keep.inPop && keep.selected.includes("百花繚乱"),
    `文字を選んだら投稿欄に文字カーソルが移り、選択が外れた（コピーできない）: ${JSON.stringify(keep)}`,
  );
  await page.fill(
    ".compose-pop .rt__content",
    "テーマ名は公式表記「百花繚乱 ―ひゃっかりょうらん―」に合わせ、ふりがなを付けてください。",
  );
  await shot("43-write-review-select");
  await page.locator(".compose-pop .rt__send").click();
  await page.waitForSelector(".rich-viewer__page .text-anchor");
  await settle();
  const quote = await page.locator(".rich-viewer__page .text-anchor").first().innerText();
  if (!quote.includes("百花繚乱")) throw new Error(`範囲へのコメントの位置がずれている: ${quote}`);
  await shot("44-write-review-comment");
  // 44a スマホ（指の操作）: 文字を選ぶと、選択が落ち着いたところで投稿欄が画面下に全幅（引用つき）で開く
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
  await page.waitForSelector(".compose-pop--docked .compose-pop__quote", { timeout: 5000 });
  expectTrue(
    (await page.locator(".compose-pop__quote").innerText()).includes("入場は無料"),
    "投稿欄に選んだ文字の引用が出ない",
  );
  await shot("44a-mobile-text-comment");
  // 44b 書式つきの入力欄はボトムシートの中でも使え、ツールバーが横にはみ出さない
  await page.locator(".compose-pop--docked .rt__content").click();
  await page.keyboard.type("**太字** と https://example.com/mobile ");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- 項目");
  {
    const m = await page.evaluate(() => {
      const bar = document.querySelector(".compose-pop--docked .rt__toolbar");
      const pop = document.querySelector(".compose-pop--docked").getBoundingClientRect();
      return {
        scrollWidth: bar.scrollWidth,
        clientWidth: bar.clientWidth,
        // ボタンを横に並べた幅（390px の画面でも、投稿欄の内側 = 390 - 余白 16×2 - 内側の余白 12×2 = 334 に収まること）
        need: [...bar.children].reduce((n, c) => n + c.getBoundingClientRect().width, 0),
        popRight: pop.right,
        popLeft: pop.left,
        innerWidth: window.innerWidth,
        strong: document.querySelectorAll(".compose-pop--docked .rt__content strong").length,
      };
    });
    console.log("mobile compose toolbar:", JSON.stringify(m));
    expectTrue(m.scrollWidth <= m.clientWidth, "モバイルの書式ツールバーが横にはみ出す");
    expectTrue(m.need <= 334, "書式ツールバーが 390px の画面の投稿欄に収まらない");
    expectTrue(m.popLeft >= 0 && m.popRight <= m.innerWidth, "モバイルの投稿欄が画面からはみ出す");
    expectTrue(m.strong === 1, "モバイルの入力欄で太字にならない");
  }
  await shot("44b-mobile-compose-markdown");
  // 44c 390px（小さいスマホ）でも同じ: ツールバーも投稿欄も画面内に収まる
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  {
    const m = await page.evaluate(() => {
      const bar = document.querySelector(".compose-pop--docked .rt__toolbar");
      const pop = document.querySelector(".compose-pop--docked").getBoundingClientRect();
      return {
        scrollWidth: bar.scrollWidth,
        clientWidth: bar.clientWidth,
        popLeft: pop.left,
        popRight: pop.right,
        innerWidth: window.innerWidth,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    console.log("390 compose toolbar:", JSON.stringify(m));
    expectTrue(m.scrollWidth <= m.clientWidth, "390px で書式ツールバーが横にはみ出す");
    expectTrue(m.popLeft >= 0 && m.popRight <= m.innerWidth, "390px で投稿欄が画面からはみ出す");
    expectTrue(m.pageOverflow <= 0, "390px でページが横にはみ出す");
  }
  await shot("44c-mobile-compose-390");
  await page.setViewportSize({ width: 412, height: 915 });
  await settle();
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
  if (PART === "all") await v2Scenes();
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
/** 外れても止めずに集め、最後にまとめて失敗にする（1 回の実行で落ちた確認を全部見る） */
const failures = [];
const expectTrue = (cond, msg) => {
  if (cond) return;
  failures.push(msg);
  console.error("  NG:", msg);
};
/**
 * 一覧のカード（Slack のスレッド式。1 件を短く見せる）の下の行を押して、スレッドのパネルを開く。パネルの locator を返す。
 * 一覧のカードを押すだけではパネルは開かない（選んで紙面のピンへ移るだけ）
 */
const openPanel = async (card) => {
  await card.locator(".thread__footer").click();
  await page.waitForSelector(".thread-panel");
  await settle();
  return page.locator(".thread-panel");
};
/** スレッドのパネルを閉じて一覧へ戻る（バーの ←。広い画面もシートも同じ） */
const closePanel = async () => {
  await page.locator(".thread-panel__bar .thread-panel__back").click();
  await page.waitForSelector(".thread-panel", { state: "detached" });
  await settle();
};
/** パネルの ⋮ からコメントを削除し（確認まで）、パネルが閉じるまで待つ */
const deleteFromPanel = async (panel) => {
  await panel.locator('.thread-panel__bar m3e-icon-button[aria-label="その他の操作"]').click();
  await settle();
  await page.locator("m3e-menu-item:visible", { hasText: "削除" }).click();
  await page.waitForSelector("m3e-dialog[open] .thread__confirm-delete");
  await page.locator("m3e-dialog[open] .thread__confirm-delete").click();
  await page.waitForSelector(".thread-panel", { state: "detached" });
};
/** 小さな PNG を作る（添付の確認用。斜めのグラデーション。seed で色を変える） */
const makePng = (w, h, seed) => {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8; // 8 bit
  head[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = (x * 255) / w;
      raw[row + 2 + x * 3] = (y * 255) / h;
      raw[row + 3 + x * 3] = (seed * 70 + (x + y) * 3) % 256;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
const pngFile = (name, seed) => ({
  name,
  mimeType: "image/png",
  buffer: makePng(160, 110, seed),
});
/**
 * 画面幅ごとの横はみ出しの測定（画面構成 v2 §3.6）: ページが画面より広くならず、切れ目の無い長い題名の行とその印が画面内に収まる。
 * 行の印は compact では題名の下（.hub-row__line--action）。測った値は標準出力に残す
 */
const LONG_TITLE = "100nc_デザインガイドライン";
const expectNoOverflow = async (route, width, height) => {
  await page.setViewportSize({ width, height });
  await go(`${BASE}${route}`);
  await page.waitForSelector(".hub .hub-row");
  await settle();
  const m = await page.evaluate((long) => {
    const rows = [...document.querySelectorAll(".hub .hub-row")];
    const longRows = rows.filter((r) => r.textContent.includes(long));
    const right = (els) => Math.max(0, ...els.map((e) => e.getBoundingClientRect().right));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
      rows: rows.length,
      chips: document.querySelectorAll(".hub .hub-row .hub-chip").length,
      actionLines: document.querySelectorAll(".hub .hub-row .hub-row__line--action").length,
      longRows: longRows.length,
      longRowRight: right(longRows),
      longChipRight: right(longRows.flatMap((r) => [...r.querySelectorAll(".hub-chip")])),
    };
  }, LONG_TITLE);
  console.log(`  overflow ${route} ${width}px:`, JSON.stringify(m));
  const where = `${route} の ${width}px`;
  expectTrue(m.scrollWidth <= m.clientWidth, `${where}で、ページが横にはみ出している`);
  expectTrue(m.longRows >= 1, `${where}に、長い題名の行がない`);
  expectTrue(
    m.longRowRight <= m.innerWidth && m.longChipRight <= m.innerWidth,
    `${where}で、長い題名の行か印が画面の右に出ている`,
  );
  expectTrue(m.chips === m.rows, `${where}で、行の印が 1 つずつ付いていない`);
  expectTrue(m.actionLines === m.rows, `${where}で、印が題名の下に置かれていない`);
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
      /ページの対応（前の版 [1-9]\d*・この版 [1-9]/.test(
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
  // タップ（すぐ離す）はふつうのタップ: コメントにならない
  await touchOn("pointerdown", 80, 120);
  await touchOn("pointerup", 80, 120);
  await page.waitForTimeout(700);
  expectTrue((await page.locator(".compose-pop").count()) === 0, "タップしただけで投稿欄が出た");
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
  // 機種・表示の設定は共通アプリバーの末尾のボタンから開く menu（浮いた FAB は無い）
  expectTrue((await page.locator(".preview-fab").count()) === 0, "浮いた設定の FAB が残っている");
  await page.locator('#appbar-actions m3e-icon-button[aria-label^="プレビューの設定"]').click();
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
    (await page.locator(".post-export__button").count()) === 0,
    "校了前に書き出せてしまう",
  );
  await shot("58-sns-review");

  // 59a SNS のプレビューの上で、本文の範囲・画像の矩形とピンを指してコメントする（利用者指示 2026-10-17）。
  // スマホの幅（412×915）で、端末の枠に入ったプレビューのまま。位置は提出した版の本文のオフセットと元画像の正規化座標で保存される
  await signInAs("mock-nogiku-reviewer");
  await page.setViewportSize({ width: 412, height: 915 });
  await go(`${sns}/v/1`);
  await page.waitForSelector(".sp-ig__slide .sp-marks", { timeout: 20_000 });
  await settle();
  // 設定のボタンは共通アプリバーの末尾（浮いた FAB は無い）。スマホの幅でもバーからはみ出さず、全画面は menu から開き ✕ で戻れる
  const barButton = page.locator('#appbar-actions m3e-icon-button[aria-label^="プレビューの設定"]');
  expectTrue((await barButton.count()) === 1, "アプリバーにプレビューの設定のボタンが無い");
  expectTrue((await page.locator(".preview-fab").count()) === 0, "浮いた設定の FAB が残っている");
  expectTrue(
    await page.evaluate(() => {
      const bar = document.querySelector(".shell__appbar")?.getBoundingClientRect();
      const btn = document
        .querySelector('#appbar-actions m3e-icon-button[aria-label^="プレビューの設定"]')
        ?.getBoundingClientRect();
      return !!bar && !!btn && btn.right <= bar.right + 0.5 && btn.left >= bar.left;
    }),
    "スマホの幅でアプリバーの設定のボタンがはみ出している",
  );
  await shot("59a0-sns-appbar-compact");
  await barButton.click();
  await page.locator("m3e-menu-item", { hasText: "全画面で見る" }).waitFor();
  await shot("59a1-sns-settings-menu-compact");
  await page.locator("m3e-menu-item", { hasText: "全画面で見る" }).click();
  await page.waitForSelector(".sp-full");
  await page.locator(".sp-full__close").click();
  await page.waitForSelector(".sp-full", { state: "detached" });
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
    await page.waitForSelector(".compose-pop .rt__content");
    await page.fill(".compose-pop .rt__content", body);
    await page.locator(".compose-pop .rt__send").click();
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
  // クリックだけではコメントにならない。押し続ける（長押し）とピン
  const layer2 = page.locator(".sp-ig__slide").nth(1).locator(".sp-marks");
  await drag(layer2, 0.7, 0.6);
  await page.waitForTimeout(500);
  expectTrue(
    (await page.locator(".compose-pop").count()) === 0,
    "SNS の画像をクリックしただけで投稿欄が出た",
  );
  const lb2 = await layer2.boundingBox();
  await mouseHold(lb2.x + lb2.width * 0.7, lb2.y + lb2.height * 0.6);
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
  await page.locator('.ws__toolbar m3e-icon-button[aria-label^="コメント（"]').click();
  await settle();
  // ピンのコメントのカード（番号は自動校正のコメントも数えるので、書いた文で探す）を押す
  await page
    .locator("m3e-bottom-sheet.ws__sheet .thread", { hasText: "画像 2 のピン" })
    .locator(".thread__body")
    .click();
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
  await page.locator('.ws__toolbar m3e-icon-button[aria-label^="コメント（"]').click();
  await settle();
  await page
    .locator("m3e-bottom-sheet.ws__sheet .thread", { hasText: "続きの本文にも" })
    .locator(".thread__body")
    .click();
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
    await page.locator('.ws__toolbar m3e-icon-button[aria-label^="コメント（"]').click();
    await settle();
  };
  await openComments();
  for (let i = 0; i < 10; i++) {
    const sel = 'm3e-bottom-sheet.ws__sheet .thread m3e-icon-button[aria-label="反映する"]';
    const left = await page.locator(sel).count();
    if (left === 0) break;
    await page.locator("m3e-bottom-sheet.ws__sheet .thread .thread__body").first().click();
    await page.locator(sel).first().click();
    await page.waitForFunction(([s, n]) => document.querySelectorAll(s).length < n, [sel, left]);
  }
  expectTrue(
    (await page
      .locator('m3e-bottom-sheet.ws__sheet .thread m3e-icon-button[aria-label="反映する"]')
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
  await page.waitForSelector(".post-export__button", { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.waitForSelector("m3e-snackbar", { state: "detached" }); // 57 の知らせ（8 秒）が消えてから撮る
  await page.locator(".post-export__button").click();
  await page.waitForSelector(".post-export__button + m3e-menu m3e-menu-item", { state: "visible" });
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
    await page.waitForSelector(".compose-pop .rt__content");
    await page.fill(".compose-pop .rt__content", body);
    await page.locator(".compose-pop .rt__send").click();
    await page.waitForSelector(".compose-pop", { state: "detached" });
  };
  const seekTo = async (ratio) => {
    const tb = await page.locator(".vtl__track").boundingBox();
    await page.mouse.click(tb.x + tb.width * ratio, tb.y + tb.height / 2);
    await page.waitForFunction(() => !document.querySelector(".vplayer video").seeking);
    await settle();
  };
  // 時点: 3 秒で止めて T（C は全体へのコメント）
  await seekTo(0.25);
  await page.locator(".vplayer").focus();
  await page.keyboard.press("t");
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
  // 映像のクリックは再生・停止（コメントにならない）
  {
    const f = await page.locator(".vplayer__frame").boundingBox();
    const paused = () => page.evaluate(() => document.querySelector(".vplayer video").paused);
    await page.mouse.click(f.x + f.width * 0.5, f.y + f.height * 0.5);
    await page.waitForFunction(() => !document.querySelector(".vplayer video").paused);
    await page.mouse.click(f.x + f.width * 0.5, f.y + f.height * 0.5);
    await page.waitForFunction(() => document.querySelector(".vplayer video").paused);
    expectTrue(
      (await paused()) && (await page.locator(".compose-pop").count()) === 0,
      "映像のクリックが再生・停止にならない（またはコメントになった）",
    );
  }
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
  if (PART === "all") await webFigmaScenes();
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
  await page.waitForTimeout(400);
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
  const holdIn = (selector) =>
    site
      .locator(selector)
      .first()
      .evaluate(async (el) => {
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        for (const type of ["pointerdown", "pointerup"]) {
          if (type === "pointerup") await new Promise((r) => setTimeout(r, 700));
          el.dispatchEvent(
            new PointerEvent(type, {
              ...at,
              button: 0,
              bubbles: true,
              cancelable: true,
              pointerId: 1,
            }),
          );
        }
      });
  // サイトの中のふつうのクリックは、サイトの操作（コメントにならない）
  await clickIn("#events h2");
  await page.waitForTimeout(500);
  expectTrue(
    (await page.locator(".compose-pop").count()) === 0,
    "ライブ表示の中をクリックしただけで投稿欄が出た",
  );
  // 長押しした要素にコメントできる
  await holdIn("#events h2");
  await page.waitForSelector(".compose-pop__place");
  const place = await page.locator(".compose-pop__place").innerText();
  expectTrue(place.includes("iPhone 17（402px）"), `投稿欄に端末と要素が出ない（${place}）`);
  await page.fill(".compose-pop .rt__content", "見出し「企画一覧」は「企画をさがす」に揃える");
  await page.locator(".compose-pop .rt__send").click();
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
  await page.fill(".compose-pop .rt__content", "このフレーム全体の余白を見直したい");
  await page.locator(".compose-pop .rt__send").click();
  await page.waitForSelector(".compose-pop", { state: "detached" });
  await page
    .locator(".thread", { hasText: "フレーム全体" })
    .locator(".thread__link")
    .first()
    .waitFor();
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
  await picker.locator("m3e-tab").nth(4).waitFor();
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
  await shot("70b-avatar-picker-compact");
  await picker.locator('[slot="actions"] m3e-button', { hasText: "キャンセル" }).click();
  await page.waitForSelector("m3e-dialog.avatar-picker[open]", { state: "detached" });
  await page.setViewportSize({ width: 1440, height: 900 });

  // 72 グラフィック制作物の原本（利用者指示 2026-10-19「pdf, adobe illustrator, indesign のファイルもあげれるように」）:
  //    .indd だけでは転送の前に断る → PDF 互換の .ai（中身は PDF）と .indd を一緒に出すと .ai が紙面に出る。
  //    ファイル一覧に形式の呼び名と保存の操作が出て、.indd は元のファイル名で保存される
  await signInAs("mock-nogiku-creator");
  await openWork("EVE 企画ポスター");
  await pdfReady();
  await drawer("版");
  await btn("新しい版を提出").click();
  await page.waitForSelector('m3e-dialog[open] input[type="file"]');
  const fileInput = page.locator('m3e-dialog[open] input[type="file"]');
  const accept = await fileInput.getAttribute("accept");
  for (const want of [".ai", ".indd", ".pdf", "image/*"])
    expectTrue(accept?.includes(want), `ファイル選択の accept に ${want} が無い（${accept}）`);
  await page.setInputFiles('m3e-dialog[open] input[type="file"]', [
    resolve(FIXTURES, "poster.indd"),
  ]);
  await page.fill("m3e-dialog[open] textarea >> nth=0", "原本の確認");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "アップロードを開始" }).click();
  await page.waitForFunction(
    () =>
      (document.querySelector('m3e-dialog[open] .mf-live[role="alert"]')?.textContent ?? "") !== "",
    null,
    { timeout: 10_000 },
  );
  expectTrue(
    (await page.locator("m3e-dialog[open] .upload-item").count()) === 0,
    ".indd だけなのに転送が始まった",
  );
  await page.setInputFiles('m3e-dialog[open] input[type="file"]', [resolve(FIXTURES, "poster.ai")]);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("m3e-dialog[open] .file-drop__files li")].some(
        (li) => li.textContent.includes("poster.ai") && li.textContent.includes("紙面に表示"),
      ),
    null,
    { timeout: 10_000 },
  );
  await shot("72a-submit-ai-indd");
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "アップロードを開始" }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".upload-item__state--verified").length >= 2,
    null,
    { timeout: 30_000 },
  );
  await page.locator("m3e-dialog[open] m3e-button", { hasText: "提出を確定する" }).click();
  await page.waitForURL(/\/v\/3$/, { timeout: 15_000 });
  await pdfReady(); // PDF 互換の .ai が紙面に出る
  await drawer("情報");
  const filesList = page.locator('[aria-label="この版のファイル"] m3e-list-item');
  expectTrue((await filesList.count()) === 2, "この版のファイルが 2 件並ばない");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10_000 }),
    page.locator('m3e-icon-button[aria-label="poster.indd をダウンロード"]').click(),
  ]);
  expectTrue(
    download.suggestedFilename() === "poster.indd",
    ".indd が元のファイル名で保存されない",
  );
  await shot("72b-revision-files-ai-indd");
}

/** 部を単独で流すときの入口: サインイン画面を開いてデモのデータを用意する（各部は自分でサインインする） */
async function startFresh() {
  await page.goto(`${BASE}/signin`);
  await ready();
  await page.evaluate(() => globalThis.__mf100demo.ensureSeeded());
}

const PARTS = {
  all: main,
  smoke: main,
  core: main,
  compact: async () => (await startFresh(), await prepareRevisions(), compactScenes()),
  v2: async () => (await startFresh(), await prepareRevisions(), v2Scenes()),
  web: async () => (await startFresh(), await prepareWeb(), webFigmaScenes()),
};
if (!PARTS[PART]) throw new Error(`E2E_PART が不明: ${PART}（${Object.keys(PARTS).join(" / ")}）`);

function writeTimings() {
  const sum = (k) => timing.scenes.reduce((a, x) => a + x[k], 0);
  const report = {
    part: PART,
    a11y: A11Y,
    wallMs: Math.round(performance.now() - runStart),
    screens: timing.scenes.length,
    totals: {
      actionMs: sum("actionMs"),
      settleMs: Math.round(timing.settle),
      sleepMs: Math.round(timing.sleep),
      screenshotMs: sum("screenshotMs"),
      axeMs: sum("axeMs"),
    },
    slowest: [...timing.scenes].sort((a, b) => b.totalMs - a.totalMs),
  };
  writeFileSync(resolve(OUT, `../timings-${PART}.json`), JSON.stringify(report, null, 2));
  const s = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const md = [
    `### E2E 区間計測（${PART}${A11Y ? "・a11y" : ""}）: 合計 ${s(report.wallMs)}・${report.screens} 画面`,
    "",
    `操作 ${s(report.totals.actionMs)} / 描画待ち ${s(report.totals.settleMs)} / 固定待ち ${s(report.totals.sleepMs)} / 撮影 ${s(report.totals.screenshotMs)} / axe ${s(report.totals.axeMs)}`,
    "",
    "| 画面 | 合計 | 操作 | 描画待ち | 固定待ち | 撮影 | axe |",
    "| --- | --: | --: | --: | --: | --: | --: |",
    ...report.slowest
      .slice(0, 15)
      .map(
        (x) =>
          `| ${x.screen} | ${s(x.totalMs)} | ${s(x.actionMs)} | ${s(x.settleMs)} | ${s(x.sleepMs)} | ${s(x.screenshotMs)} | ${s(x.axeMs)} |`,
      ),
    "",
  ].join("\n");
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
}

const reportFailures = () => {
  if (!failures.length) return;
  console.error(`NG ${failures.length} 件:`);
  for (const f of failures) console.error("  -", f);
};

try {
  await PARTS[PART]();
} catch (e) {
  console.error("FAILED:", e?.message ?? e);
  try {
    console.error("URL:", page.url());
    console.error("TEXT:", (await page.evaluate(() => document.body.innerText)).slice(0, 1500));
    await page.screenshot({ path: resolve(OUT, "zz-failure.png") });
  } catch {}
  await browser.close();
  reportFailures();
  process.exit(1);
}
await browser.close();
if (A11Y) {
  // 全部を流したときだけ docs の報告を書き換える。部ごとのときは撮影の出力先に部の名前で置く
  const path =
    PART === "all"
      ? resolve(here, "../../../docs/a11y-report.json")
      : resolve(OUT, `a11y-report-${PART}.json`);
  writeFileSync(path, JSON.stringify(a11yReport, null, 2));
  console.log("a11y report ->", path);
}
writeTimings();
console.log("done ->", OUT);
for (const m of a11yBlocking) failures.push(`a11y ${m}`);
if (failures.length) {
  reportFailures();
  process.exit(1);
}
