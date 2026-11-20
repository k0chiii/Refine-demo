import { defineConfig, devices } from "@playwright/test";

/**
 * 機能の E2E（e2e/specs/*.spec.ts）。デモ版（ブラウザ内の Convex。実データなし）を建てて流す。
 * - spec は 1 本ずつ新しいページ（= 新しいデモのデータ）から始まり、前提は e2e/support/scenarios.ts で自分で用意する。
 *   ほかの spec の結果に頼らないので、単独・並列・逆順で流せる（docs/TESTING_AGENT_POLICY.md）
 * - 画面の撮影と a11y（axe）は e2e/screenshots.mjs の受け持ち。ここでは操作と結果だけを確かめる
 * - タグ: @smoke（PR で必ず流す主要な流れ）・@core（main で流す業務の流れ）
 *
 *   pnpm --filter @mf100/web e2e          # デモ版をビルドして全部
 *   pnpm --filter @mf100/web e2e:smoke    # @smoke だけ
 *   E2E_PREBUILT=1 …                      # dist-demo を建て直さない（CI はビルドを別の段で済ませる）
 *
 * Cloudflare 版の疎通（@cloudflare。e2e/specs/cloudflare-smoke.spec.ts）は、デモ版の流れには混ぜない（Worker が要る）。
 *   pnpm --filter @mf100/web e2e:cloudflare   # E2E_CLOUDFLARE=1。Worker と web（--mode cloudflare）を起こして、@cloudflare だけ流す
 * CI は e2e（デモ版・@cloudflare 以外）と e2e-cloudflare（こちら）を別のジョブにしている。
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);
const CI = Boolean(process.env.CI);
const preview = `pnpm exec vp preview --mode demo --outDir dist-demo --port ${PORT} --host 127.0.0.1 --strictPort`;

// Cloudflare 版の疎通。名前解決に頼らない（`localhost` は ::1 を先に引くが、Worker は 127.0.0.1 で待つ）ので、
// Worker・web・spec が引く URL をすべて 127.0.0.1 で揃える。Worker の ALLOWED_ORIGINS は web の origin と一字一句同じでないと CORS で落ちる
const CLOUDFLARE = Boolean(process.env.E2E_CLOUDFLARE);
const CF_API_URL = "http://127.0.0.1:8790";
const CF_WEB_URL = "http://127.0.0.1:5174";
const BASE_URL = process.env.BASE_URL ?? (CLOUDFLARE ? CF_WEB_URL : `http://127.0.0.1:${PORT}`);

const demoServer = {
  command: process.env.E2E_PREBUILT
    ? preview
    : `pnpm exec vp build --mode demo --outDir dist-demo && ${preview}`,
  url: BASE_URL,
  reuseExistingServer: !CI,
  timeout: 180_000,
};

const cloudflareServers = [
  {
    // 空のデータから（前回の Durable Object の状態を引き継がない）。制作者を管理者にして、登録できるようにする
    command: `rm -rf .wrangler/state && pnpm dev --ip 127.0.0.1 --port 8790 --var MF100_SYSTEM_ADMIN_SUBJECTS:mock-nogiku-creator --var ALLOWED_ORIGINS:${CF_WEB_URL}`,
    cwd: "../cloudflare",
    url: `${CF_API_URL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  {
    // VITE_* はビルドに焼き込まれる。dev ではなく preview を使う理由は e2e/specs/cloudflare-smoke.spec.ts の冒頭
    command: `pnpm exec vp build --mode cloudflare && pnpm exec vp preview --mode cloudflare --port 5174 --host 127.0.0.1 --strictPort`,
    env: { VITE_CLOUDFLARE_URL: CF_API_URL, VITE_NOGIKU_MOCK: "true" },
    url: CF_WEB_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
];

export default defineConfig({
  testDir: "./e2e/specs",
  // デモ版の流れには Worker が要る @cloudflare を混ぜない。E2E_CLOUDFLARE=1 のときはその逆（@cloudflare だけ）
  ...(CLOUDFLARE ? { grep: /@cloudflare/ } : { grepInvert: /@cloudflare/ }),
  outputDir: "./e2e/out/test-results",
  fullyParallel: true,
  forbidOnly: CI,
  // 一度だけやり直す。やり直して通ったものは flaky として報告に残る（隠さない）
  retries: CI ? 1 : 0,
  ...(CI ? { workers: 4 } : {}),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: CI
    ? [["blob", { outputDir: "./e2e/out/blob-report" }], ["github"], ["list"]]
    : [["list"], ["html", { outputFolder: "./e2e/out/playwright-report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // CI は runner の Chrome、手元のクラウド環境は /opt/pw-browsers/chromium を指す（Playwright のブラウザを落とさない）
    ...(process.env.CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  // BASE_URL を渡したときは、建ててある preview（や dev）をそのまま使う
  ...(process.env.BASE_URL ? {} : { webServer: CLOUDFLARE ? cloudflareServers : demoServer }),
});
