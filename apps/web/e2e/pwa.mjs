/**
 * PWA の確認（デモモードのビルドで）。
 *   1) pnpm build:demo && pnpm exec vp preview --mode demo --outDir dist-demo --port 4173
 *   2) BASE_URL=http://127.0.0.1:4173 pnpm e2e:pwa
 * - マニフェスト（名前・start_url・display・アイコン 192/512/maskable）とアイコンの実寸
 * - Service Worker が登録されて画面を制御し、外枠（index.html・JS・CSS）を先にキャッシュしている
 * - キャッシュに入るのは同一オリジンの静的ファイルだけ（API・データは入らない）
 * - オフラインで開き直しても外枠が出て、オフラインの知らせ（M3E snackbar）が出る
 * - 新しい版（sw.js の VERSION を一時的に書き換える）が届くと「更新」が出て、押すと切り替わり古いキャッシュが消える
 * - 新しい版の外枠は、前の版にあるハッシュ付きファイル（/assets/*）を通信せずに写して用意する（取り直さない。index.html などは取り直す）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// Service Worker 自身の通信（install 中の取得）を context の request として見るための実験機能
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const DIST =
  process.env.DIST_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../dist-demo");

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  locale: "ja-JP",
  viewport: { width: 412, height: 915 },
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failed++;
};

try {
  await page.goto(`${BASE}/signin`);
  await page.waitForSelector("#root *");

  // マニフェスト
  const href = await page.getAttribute('link[rel="manifest"]', "href");
  const manifest = await (await page.request.get(new URL(href, BASE).toString())).json();
  check(!!manifest.name && !!manifest.short_name, "マニフェスト: name / short_name");
  check(
    manifest.start_url === "/" && manifest.scope === "/" && manifest.display === "standalone",
    "マニフェスト: start_url / scope / display",
  );
  const sizes = (purpose) =>
    manifest.icons
      .filter((i) => (i.purpose ?? "any").split(" ").includes(purpose))
      .map((i) => i.sizes);
  check(
    sizes("any").includes("192x192") && sizes("any").includes("512x512"),
    "マニフェスト: アイコン 192・512",
  );
  check(sizes("maskable").includes("512x512"), "マニフェスト: maskable アイコン");
  for (const icon of manifest.icons) {
    const dims = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return `${img.naturalWidth}x${img.naturalHeight}`;
    }, icon.src);
    check(dims === icon.sizes, `アイコンの実寸 ${icon.src} = ${icon.sizes}`);
  }
  check(
    (await page.getAttribute('link[rel="apple-touch-icon"]', "href")) !== null,
    "apple-touch-icon",
  );

  // Service Worker（初回は登録して install。制御は次の読み込みから）
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, script: reg.active?.scriptURL ?? null };
  });
  check(
    sw.script?.endsWith("/sw.js") && sw.scope === `${BASE}/`,
    `Service Worker が有効（${sw.script}）`,
  );
  await page.reload();
  await page.waitForSelector("#root *");
  check(
    await page.evaluate(() => !!navigator.serviceWorker.controller),
    "Service Worker が画面を制御している",
  );

  const cached = await page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys()) out.push({ name, url: req.url });
    return out;
  });
  const paths = cached.map((c) => new URL(c.url));
  check(
    paths.some((u) => u.pathname === "/index.html"),
    "外枠: index.html をキャッシュ",
  );
  check(
    paths.some((u) => /^\/assets\/.+\.js$/.test(u.pathname)),
    "外枠: JS をキャッシュ",
  );
  check(
    paths.some((u) => /^\/assets\/.+\.css$/.test(u.pathname)),
    "外枠: CSS をキャッシュ",
  );
  check(
    paths.every((u) => u.origin === new URL(BASE).origin),
    "キャッシュは同一オリジンだけ",
  );
  check(
    paths.every((u) =>
      /^\/(index\.html|sw\.js|manifest\.webmanifest|assets\/|icons\/|pdfjs\/|ocr\/)/.test(
        u.pathname,
      ),
    ),
    "キャッシュは静的ファイルだけ（API・データは入らない）",
  );

  // オフライン: 知らせが出て、開き直しても外枠が出る
  await context.setOffline(true);
  await page.waitForSelector("m3e-snackbar", { timeout: 5000 }).catch(() => {});
  check((await page.locator("m3e-snackbar").count()) > 0, "オフラインの知らせ（snackbar）が出る");
  await page.reload();
  await page.waitForSelector("#root *", { timeout: 10_000 });
  check(
    await page.evaluate(() => (document.querySelector("#root")?.childElementCount ?? 0) > 0),
    "オフラインで開き直しても画面が出る",
  );
  await context.setOffline(false);
  await page.goto(`${BASE}/signin`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  // 新しい版: 配信中の sw.js の版だけ変えて更新を確かめる（終わったら必ず戻す）
  const swPath = resolve(DIST, "sw.js");
  const original = readFileSync(swPath, "utf8");
  try {
    const before = await page.evaluate(async () =>
      (await caches.keys()).filter((k) => k.startsWith("mf100-shell-")),
    );
    writeFileSync(
      swPath,
      original.replace(/const VERSION = "([0-9a-f]+)"/, 'const VERSION = "$1e2e"'),
    );
    // 新しい版の install が取りに行ったパス。Service Worker 自身の取得（referer が sw.js）だけを数える
    // （画面が使うファイルを Service Worker が中継した通信は、画面からの要求なので含めない）
    const installFetched = [];
    context.on("request", (r) => {
      try {
        if (r.serviceWorker() && (r.headers()["referer"] ?? "").endsWith("/sw.js"))
          installFetched.push(new URL(r.url()).pathname);
      } catch {
        // ページの通信
      }
    });
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    // 更新の操作（snackbar の「更新」ボタン。名前は操作を見つける手がかり）が出るのを待つ
    const updateButton = page.locator("m3e-snackbar").getByRole("button", { name: "更新" });
    await updateButton.waitFor({ timeout: 15_000 });
    check(true, "新しい版: 更新の操作が出る");
    const reloaded = page.waitForEvent("framenavigated", { timeout: 15_000 });
    await updateButton.click();
    await reloaded;
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    // 古い外枠のキャッシュは新しい SW の activate が消す。1 つになるまで待つ
    await page.waitForFunction(
      async (b) => {
        const k = (await caches.keys()).filter((n) => n.startsWith("mf100-shell-"));
        return k.length === 1 && !b.includes(k[0]);
      },
      before,
      { timeout: 10_000 },
    );
    const after = await page.evaluate(async () =>
      (await caches.keys()).filter((k) => k.startsWith("mf100-shell-")),
    );
    check(
      after.length === 1 && after[0].endsWith("e2e") && !before.includes(after[0]),
      `新しい版: 切り替わり古い外枠のキャッシュが消える（${before.join()} → ${after.join()}）`,
    );
    // 新しい版の外枠が揃っている（写したものを含めて、一覧のすべてがキャッシュにある）
    const precache = JSON.parse(/const PRECACHE = (\[.*?\]);/s.exec(original)[1]);
    const cached = await page.evaluate(
      async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname),
      after[0],
    );
    const missing = precache.filter((p) => !cached.includes(p));
    check(
      missing.length === 0,
      `新しい版: 外枠の一覧 ${precache.length} 本がすべて揃う（欠け ${missing.length}）`,
    );
    const assetsFetched = installFetched.filter((p) => p.startsWith("/assets/"));
    check(
      assetsFetched.length === 0,
      `新しい版: ハッシュ付きの /assets/* を取り直さない（通信 ${assetsFetched.length} 本）`,
    );
    check(installFetched.includes("/index.html"), "新しい版: index.html は取り直す");
  } finally {
    writeFileSync(swPath, original);
  }
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} 件失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);
