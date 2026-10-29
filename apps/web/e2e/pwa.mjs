/**
 * PWA の確認（デモモードのビルドで）。
 *   1) pnpm build:demo && pnpm exec vp preview --mode demo --outDir dist-demo --port 4173
 *   2) BASE_URL=http://127.0.0.1:4173 pnpm e2e:pwa
 * - マニフェスト（名前・start_url・display・アイコン 192/512/maskable）とアイコンの実寸
 * - Service Worker が登録されて画面を制御し、外枠（index.html・JS・CSS）を先にキャッシュしている
 * - キャッシュに入るのは同一オリジンの静的ファイルだけ（API・データは入らない）
 * - オフラインで開き直しても外枠が出て、オフラインの知らせ（M3E snackbar）が出る
 * - 新しい版（sw.js の VERSION を一時的に書き換える）が届くと「更新」が出て、押すと切り替わり古いキャッシュが消える
 * - 本番（Cloudflare Pages）と同じ /index.html → / のリダイレクトを挟んでも、画面の移動が止まらない
 * - 新しい版の外枠は、前の版にあるハッシュ付きファイル（/assets/*）を通信せずに写して用意する（取り直さない。index.html などは取り直す）
 * - 外枠の外で実行時にキャッシュしたハッシュ付きファイル（画面のチャンク・フォント）も、新しい版のキャッシュへ写されて残る
 * - この版の JS・CSS は、開いたことのない画面のものも先にキャッシュする（デプロイで消えたチャンクの画面も、古い外枠のまま開ける）
 * - 無い /assets/* に配信側が返す index.html（200）を、JS の代わりに渡さず、キャッシュにも残さない
 * - それでも画面のチャンクを読めなければ、待機中の新しい版へ「更新」を押さずに切り替わる
 * - アイコンのフォントも install で入る。名前の変わった版でも、配信側から消えたあとにアイコンが文字にならない
 * - 開き直した直後（load が遅い回線）に画面のチャンクを読めなくても、古い外枠のまま読み直しを重ねない
 * - 古い画面で消えたチャンクを読めないと、アプリのエラー画面を出し、まだ届いていない新しい版を入れて切り替える
 * - 自動で直せない（回線が切れたまま）ときは、アプリのエラー画面の「再読み込み」で開き直せる
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// Service Worker 自身の通信（install 中の取得）を context の request として見るための実験機能
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const DIST =
  process.env.DIST_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../dist-demo");

const ORIGIN = new URL(process.env.BASE_URL ?? "http://127.0.0.1:4173");
/**
 * 画面からの要求には配信側から消えたことにする /assets/*（新しい版の install の取得には渡す。
 * 新しい版が自分の名前で持っている同じ中身の代わり）
 */
const gone = new Set();
/** この時刻まで、そのパスへの通信を切る（回線の途切れ） */
const cutUntil = new Map();
/** そのパスの応答を遅らせる ms（遅い回線） */
const slow = new Map();
/**
 * 本番の Cloudflare Pages と同じく /index.html を / へ 308 でリダイレクトする中継を挟んで確かめる
 * （リダイレクトを経た外枠を SW が画面の移動に返すと、ブラウザが読み込みを止める。2026-10-18 の不具合）
 */
const proxy = http.createServer(async (req, res) => {
  if (req.url === "/index.html" || req.url?.startsWith("/index.html?")) {
    res.writeHead(308, { Location: "/" });
    res.end();
    return;
  }
  // Pages は無いファイルにも index.html を 200 で返す（/assets/* でも。デプロイで消えたチャンクはこうなる）
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if ((cutUntil.get(path) ?? 0) > Date.now()) {
    req.socket.destroy();
    return;
  }
  if (slow.has(path)) await new Promise((r) => setTimeout(r, slow.get(path)));
  const fromInstall = (req.headers.referer ?? "").endsWith("/sw.js");
  if (
    path.startsWith("/assets/") &&
    (!existsSync(resolve(DIST, `.${path}`)) || (gone.has(path) && !fromInstall))
  ) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(resolve(DIST, "index.html")));
    return;
  }
  const upstream = http.request(
    {
      host: ORIGIN.hostname,
      port: ORIGIN.port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});
await new Promise((ok) => proxy.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${proxy.address().port}`;
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
/** 校正者としてサインインし、画面を読み直さずに /check へ移る（いま動いている外枠のまま、/check のチャンクを読ませる） */
const openCheck = async (p = page) => {
  await p.waitForFunction(() => !!globalThis.__mf100demo && !!globalThis.__mf100router);
  await p.evaluate(() => globalThis.__mf100demo.signIn("mock-nogiku-reviewer"));
  // 入口の振り分け（/ → /make・/check）が終わってから移る（途中で移ると振り分けに上書きされる）
  await p.locator("[data-hub]").first().waitFor({ timeout: 10_000 });
  await p.evaluate(() => globalThis.__mf100router.navigate({ to: "/check" }));
};
const swPath = resolve(DIST, "sw.js");
const original = readFileSync(swPath, "utf8");
/** 配信中の sw.js の版だけ変える（新しい版のデプロイ。終わったら original に戻す） */
const deploy = (suffix) =>
  writeFileSync(
    swPath,
    original.replace(/const VERSION = "([0-9a-f]+)"/, `const VERSION = "$1${suffix}"`),
  );
const assetsOf = (pattern) =>
  readdirSync(resolve(DIST, "assets"))
    .filter((f) => pattern.test(f))
    .map((f) => `/assets/${f}`);
const [iconFont] = assetsOf(/^material-symbols-subset-.+\.woff2$/);
const shells = (p) =>
  p.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("mf100-shell-")));
const inCache = (p, name, path) =>
  p.evaluate(
    ([n, q]) =>
      caches
        .open(n)
        .then((c) => c.match(q, { ignoreVary: true }))
        .then((r) => !!r),
    [name, path],
  );
const dropFromCache = (p, name, path) =>
  p.evaluate(
    ([n, q]) => caches.open(n).then((c) => c.delete(q, { ignoreVary: true })),
    [name, path],
  );
/**
 * 読み直しをまたいで、条件が成り立つまで待つ。条件は Promise を返してよい
 * （page.waitForFunction は返った Promise をそのまま真とみなし、待たずに終わる）
 */
const eventually = async (p, fn, ms, arg) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await p.evaluate(fn, arg).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};
/** 新しい版が install を終えて待機する（install 中の版が無い）まで待つ */
const waitForWaiting = async (p) => {
  const settled = await eventually(
    p,
    async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return !!r?.waiting && !r.installing;
    },
    15_000,
  );
  if (!settled) throw new Error("新しい版が待機にならない");
};
/** 別のタブ（sessionStorage も別）で開き、Service Worker の制御下にする */
const freshPage = async () => {
  const ctx = await browser.newContext({ locale: "ja-JP", viewport: { width: 412, height: 915 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.error("[pageerror]", e.message));
  await p.goto(`${BASE}/signin`);
  await p.waitForSelector("#root *");
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await p.waitForSelector("#root *");
  return p;
};
const onlyShell = (suffix) =>
  `(async () => (await caches.keys()).filter((k) => k.startsWith("mf100-shell-")).every((k) => k.endsWith(${JSON.stringify(suffix)})))()`;
const iconFontLoaded = (p) =>
  p.evaluate(() =>
    document.fonts.load('400 24px "Material Symbols Outlined"').then(
      () => document.fonts.check('400 24px "Material Symbols Outlined"'),
      () => false,
    ),
  );

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
  check(
    await inCache(page, (await shells(page))[0], iconFont),
    `install でアイコンのフォント（${iconFont}）もキャッシュに入る（制御下で開く前から）`,
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

  const shellCached = cached
    .filter((c) => c.name.startsWith("mf100-shell-"))
    .map((c) => new URL(c.url).pathname);
  const code = readdirSync(resolve(DIST, "assets"))
    .filter((f) => /\.(js|css)$/.test(f))
    .map((f) => `/assets/${f}`);
  const unopened = code.find((p) => p.startsWith("/assets/check-"));
  check(
    !!unopened && shellCached.includes(unopened),
    `開いていない画面のチャンク（${unopened}）がキャッシュにある`,
  );
  const uncached = code.filter((p) => !shellCached.includes(p));
  check(
    uncached.length === 0,
    `この版の JS・CSS ${code.length} 本がすべてキャッシュにある（欠け ${uncached.length}）`,
  );

  const absent = "/assets/e2e-missing-abc123.js";
  const status = await page.evaluate(
    (p) =>
      fetch(p).then(
        (r) => r.status,
        () => 0,
      ),
    absent,
  );
  check(status === 0 || status === 404, `無い /assets/* に HTML を返さない（status ${status}）`);
  const kept = await page.evaluate(async (p) => {
    for (let i = 0; i < 10; i++) {
      if (await caches.match(p)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }, absent);
  check(!kept, "無い /assets/* の HTML をキャッシュに残さない");

  const chunk = resolve(DIST, `.${unopened}`);
  renameSync(chunk, `${chunk}.gone`);
  try {
    const shown = await openCheck()
      .then(() => page.locator('[data-hub="check"]').first().waitFor({ timeout: 10_000 }))
      .then(
        () => true,
        () => false,
      );
    check(shown, "配信側から消えたチャンクの画面（/check）を、古い外枠のまま開ける");
  } finally {
    renameSync(`${chunk}.gone`, chunk);
  }
  await page.goto(`${BASE}/signin`);
  await page.waitForSelector("#root *");

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
  try {
    const before = await page.evaluate(async () =>
      (await caches.keys()).filter((k) => k.startsWith("mf100-shell-")),
    );
    // ここまでに画面が実行時にキャッシュした、外枠の外の /assets/*（サインイン画面のチャンクなど）
    const precache = JSON.parse(/const PRECACHE = (\[.*?\]);/s.exec(original)[1]);
    const runtimeCached = (
      await page.evaluate(
        async (name) =>
          (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname),
        before[0],
      )
    ).filter((p) => p.startsWith("/assets/") && !precache.includes(p));
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
    await eventually(
      page,
      async (b) => {
        const k = (await caches.keys()).filter((n) => n.startsWith("mf100-shell-"));
        return k.length === 1 && !b.includes(k[0]);
      },
      10_000,
      before,
    );
    const after = await page.evaluate(async () =>
      (await caches.keys()).filter((k) => k.startsWith("mf100-shell-")),
    );
    check(
      after.length === 1 && after[0].endsWith("e2e") && !before.includes(after[0]),
      `新しい版: 切り替わり古い外枠のキャッシュが消える（${before.join()} → ${after.join()}）`,
    );
    // 新しい版の外枠が揃っている（写したものを含めて、一覧のすべてがキャッシュにある）
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
    const lost = runtimeCached.filter((p) => !cached.includes(p));
    check(
      runtimeCached.length > 0 && lost.length === 0,
      `新しい版: 実行時にキャッシュした外枠の外の /assets/* ${runtimeCached.length} 本が写されて残る（消えた ${lost.length}）`,
    );

    writeFileSync(
      swPath,
      original.replace(/const VERSION = "([0-9a-f]+)"/, 'const VERSION = "$1e2f"'),
    );
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    await waitForWaiting(page);
    // 待機中の版が入ったあとで、いまの版のキャッシュと配信側の両方から /check のチャンクを消す
    await page.evaluate(
      ([name, p]) => caches.open(name).then((c) => c.delete(p)),
      [after[0], unopened],
    );
    renameSync(chunk, `${chunk}.gone`);
    try {
      const loaded = page.waitForEvent("load", { timeout: 15_000 }).then(
        () => true,
        () => false,
      );
      await openCheck().catch(() => {});
      const reloaded = await loaded;
      const shells = await page.evaluate(async () =>
        (await caches.keys()).filter((k) => k.startsWith("mf100-shell-")),
      );
      check(
        reloaded && shells.length === 1 && shells[0].endsWith("e2f"),
        `読めないチャンクがあると、待機中の新しい版へ「更新」を押さずに切り替わる（${shells.join()}）`,
      );
    } finally {
      renameSync(`${chunk}.gone`, chunk);
    }
  } finally {
    writeFileSync(swPath, original);
  }
  // アイコンのフォント: 名前の変わった新しい版（前の版のキャッシュに無い）でも install で入れる。
  // 次のデプロイで配信側から消えても、その版の画面のアイコンは文字にならない
  {
    const p = await freshPage();
    const [a] = await shells(p);
    await dropFromCache(p, a, iconFont);
    try {
      deploy("f0");
      await p.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
      await waitForWaiting(p);
      gone.add(iconFont);
      const update = p.locator("m3e-snackbar").getByRole("button", { name: "更新" });
      await update.waitFor({ timeout: 15_000 });
      const reloaded = p.waitForEvent("load", { timeout: 15_000 });
      await update.click();
      await reloaded;
      const switched = await eventually(p, onlyShell("f0"), 10_000);
      check(
        switched && (await iconFontLoaded(p)),
        "名前の変わったアイコンのフォントも新しい版の install で入り、配信側から消えてもアイコンが文字にならない",
      );
    } finally {
      gone.delete(iconFont);
      writeFileSync(swPath, original);
      await p.context().close();
    }
  }

  // 開き直した直後に画面のチャンクを読めない（新しい版は待機中。回線が遅く、load がなかなか来ない）。
  // 待機中の版がいつ入れ替わるかはブラウザ次第（Chromium は前の版が取得を抱えていると待たせ、そのまま止まることもある）なので、
  // 確かめるのは画面側: 同じ古い外枠のまま読み直しを重ねず、アプリのエラー画面か新しい版の画面を出す
  {
    const p = await freshPage();
    const [a] = await shells(p);
    const [signin] = assetsOf(/^signin-.+\.js$/);
    try {
      deploy("s0");
      await p.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
      await waitForWaiting(p);
      await dropFromCache(p, a, signin);
      gone.add(signin);
      await dropFromCache(p, a, iconFont);
      slow.set(iconFont, 8000);
      await p.reload({ waitUntil: "commit" });
      let staleReloads = 0;
      p.on("framenavigated", (f) => {
        if (f !== p.mainFrame()) return;
        void eventually(p, onlyShell("s0"), 500).then((switched) => {
          if (!switched) staleReloads++;
        });
      });
      await new Promise((r) => setTimeout(r, 6000));
      const shown = await eventually(
        p,
        `!!document.querySelector("[data-route-error] m3e-button") || (!!document.querySelector("main.signin") && ${onlyShell("s0")})`,
        1000,
      );
      check(
        shown && staleReloads === 0,
        `開き直した直後に画面のチャンクを読めなくても（load が遅い回線）、古い外枠のまま読み直しを重ねず、アプリのエラー画面か新しい版の画面を出す（古い外枠での読み直し ${staleReloads} 回）`,
      );
    } finally {
      gone.clear();
      slow.clear();
      writeFileSync(swPath, original);
      await p.context().close();
    }
  }

  // 古い画面で、消えたチャンクを読めない（新しい版はまだ届いていない）
  {
    const p = await freshPage();
    const [a] = await shells(p);
    const [checkChunk] = assetsOf(/^check-.+\.js$/);
    try {
      await dropFromCache(p, a, checkChunk);
      gone.add(checkChunk);
      deploy("o0");
      const shown = p
        .locator("[data-route-error]")
        .waitFor({ timeout: 10_000 })
        .then(
          () => true,
          () => false,
        );
      await openCheck(p).catch(() => {});
      const switched = await eventually(
        p,
        `!!document.querySelector("main.signin") && ${onlyShell("o0")}`,
        15_000,
      );
      check(
        (await shown) && switched,
        "古い画面で消えたチャンクを読めないと、アプリのエラー画面を出し、まだ届いていない新しい版を入れて切り替える",
      );
    } finally {
      gone.clear();
      writeFileSync(swPath, original);
      await p.context().close();
    }
  }

  // 回線が切れていてチャンクを読めない（キャッシュにも無い）。自動の読み直しが止まったあと
  {
    const p = await freshPage();
    const [a] = await shells(p);
    const [checkChunk] = assetsOf(/^check-.+\.js$/);
    await dropFromCache(p, a, checkChunk);
    try {
      // 開くたびに回線を切り、自動で読み直さなくなるまで繰り返す
      for (let i = 0; i < 4; i++) {
        cutUntil.set(checkChunk, Date.now() + 2000);
        const reloaded = p.waitForEvent("load", { timeout: 6000 }).then(
          () => true,
          () => false,
        );
        await openCheck(p).catch(() => {});
        if (!(await reloaded)) break;
      }
      cutUntil.clear();
      const retry = p.locator("[data-route-error] m3e-button");
      const offered = await retry.waitFor({ timeout: 3000 }).then(
        () => true,
        () => false,
      );
      let reopened = false;
      if (offered) {
        const reloaded = p.waitForEvent("load", { timeout: 10_000 });
        await retry.click();
        await reloaded;
        await openCheck(p);
        reopened = await p
          .locator('[data-hub="check"]')
          .first()
          .waitFor({ timeout: 10_000 })
          .then(
            () => true,
            () => false,
          );
      }
      check(
        offered && reopened,
        "回線が切れたまま自動で直せないときは、アプリのエラー画面の「再読み込み」で開き直せる",
      );
    } finally {
      cutUntil.clear();
      await p.context().close();
    }
  }
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await browser.close();
  proxy.close();
}
console.log(failed ? `\n${failed} 件失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);
