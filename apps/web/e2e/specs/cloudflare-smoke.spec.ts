import { App, expect, test as base, WORKS_ENTRY } from "../support/app";

/**
 * Cloudflare 版（`--mode cloudflare`。apps/cloudflare の Worker + Durable Object に向けた web）の疎通。
 * デモ版と違い、ブラウザの外にデータがある。だからデモ版の流れ（`pnpm e2e`・CI の e2e ジョブ）には含めない
 * （playwright.config.ts が @cloudflare を外す）。専用の入口で流す。CI では e2e-cloudflare ジョブ。
 *
 *   pnpm --filter @mf100/web e2e:cloudflare
 *
 * これが Worker（空のデータから。制作者を管理者にして登録できるようにし、web の origin を CORS に許す。127.0.0.1:8790）と
 * web（`vp build --mode cloudflare` して preview。127.0.0.1:5174）を起こしてから、この spec だけを流す。
 * preview を使うのは、dev だと M3E の select が読み込みの競合で開かないことがあるため（Lit の class-field-shadowing）。
 * `localhost` ではなく 127.0.0.1 に揃えているのは、`localhost` が ::1 を先に引いて Worker（127.0.0.1 で待つ）に届かないため。
 *
 * 自分で起こしたものに向けるときは、Worker と web を手で起こし（apps/cloudflare の `pnpm dev --ip 127.0.0.1 --port 8790
 * --var MF100_SYSTEM_ADMIN_SUBJECTS:mock-nogiku-creator --var ALLOWED_ORIGINS:<web の origin>`、apps/web を
 * `VITE_CLOUDFLARE_URL=<Worker> VITE_NOGIKU_MOCK=true` で `vp build --mode cloudflare` → `vp preview --mode cloudflare`）、
 * `BASE_URL=<web> CLOUDFLARE_URL=<Worker> E2E_CLOUDFLARE=1 pnpm exec playwright test` で流す。ブラウザは CHROMIUM_PATH で指定できる。
 *
 * 制作物の題名は実行のたびに変える（Worker のデータは spec をまたいで残るので、前回の分と取り違えない）。
 */
// ルートからの vp check は node の型を持たないので、process は型を通さずに読む
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const CLOUDFLARE_URL = (env?.CLOUDFLARE_URL ?? "http://127.0.0.1:8790").replace(/\/$/, "");

const test = base.extend<{ app: App }>({
  // デモの `__mf100demo` には頼らない。サインイン画面を開くだけ
  app: async ({ page }, use) => {
    page.on("pageerror", (e) => console.error("[pageerror]", e.message));
    await use(new App(page));
  },
});

test.describe("Cloudflare 版", { tag: "@cloudflare" }, () => {
  test("モックでサインインし、制作物を登録すると一覧に出て、別のタブの画面にも変更が届く", async ({
    app,
    page,
    context,
    request,
  }) => {
    const run = Date.now().toString(36);
    const title = `CF 疎通 ${run}`;
    const renamed = `CF 疎通 改 ${run}`;

    // 校了者は登録で選ぶので、先に 1 人サインインさせて利用者の行を作っておく（画面からは作れない）
    const approverName = "こまば こうりょう";
    const mock = await request.post(`${CLOUDFLARE_URL}/auth/mock`, {
      // コードは使わない（行を作るだけ）が、challenge は要る
      data: {
        sub: "mock-nogiku-approver",
        name: approverName,
        hurigana: approverName,
        challenge: "A".repeat(43),
      },
    });
    expect(mock.ok()).toBe(true);

    // サインイン（VITE_NOGIKU_MOCK=true なので、既定のモック利用者 mock-nogiku-creator になる）
    await page.goto("/signin");
    await app.btn("Nogiku でサインイン").click();
    await page.waitForURL((u) => ["/make", "/check"].includes(u.pathname), { timeout: 15_000 });
    await app.settle();

    // 登録（UI から）
    await page.goto("/works"); // データは Worker にあるので、読み直して移ってよい（__mf100router はデモ専用）
    await page.locator('.shell__appbar m3e-icon-button[aria-label="制作物を登録"]').click();
    const dialog = app.dialog();
    // 統括に本人が入るのは me の応答のあと。デモと違って応答は遅れるので、入るまで待つ（入力の途中で描き直されて選択肢が閉じるのを避ける）
    await expect(
      dialog.locator("m3e-form-field", { hasText: "統括" }).locator("m3e-input-chip"),
    ).toHaveCount(1);
    await dialog.locator("input").first().fill(title);
    await app.pickSelectOption(dialog, "ジャンル", "印刷物（紙・ビラ）");
    await app.fillOutlinedDate(dialog, "仕上がり日", "2026-12-01");
    await app.pickUser(dialog.locator("m3e-form-field", { hasText: "制作者" }), "さつき めい");
    await app.pickUser(dialog.locator("m3e-form-field", { hasText: "校了" }).first(), approverName);
    await dialog.locator("m3e-button", { hasText: "登録" }).click();
    await page.waitForURL(/\/works\/[^/]+$/);

    // 一覧に出る
    await page.goto("/works");
    const row = (p: typeof page, name: string) => p.locator(WORKS_ENTRY, { hasText: name });
    await expect(row(page, title)).toHaveCount(1);

    // リロードしても残る（Worker が持っている。サインインも localStorage から引き継ぐ）
    await page.reload();
    await expect(row(page, title)).toHaveCount(1);

    // 別のタブ（同じ利用者・同じ localStorage）で見ているとき、1 つ目で名称を変える。2 つ目は購読で読み直す
    const other = await context.newPage();
    other.on("pageerror", (e) => console.error("[pageerror:2]", e.message));
    await other.goto("/works");
    await expect(row(other, title)).toHaveCount(1);

    const edit = await app.editWorkFromList(title);
    await edit.locator("input").first().fill(renamed);
    await edit.locator("m3e-button", { hasText: "保存" }).click();
    await page.waitForSelector("m3e-dialog[open]", { state: "detached" });

    await expect(row(other, renamed)).toHaveCount(1);
    await expect(row(other, title)).toHaveCount(0);
    await other.close();
  });
});
