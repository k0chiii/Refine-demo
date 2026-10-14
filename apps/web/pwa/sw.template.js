/* MF100 校正システムの Service Worker（ビルド時に vite.config.ts の pwa() が sw.js として書き出す）。
 *
 * 方針: キャッシュするのは「アプリの外枠」（同一オリジンの HTML・JS・CSS・フォント・アイコン、PDF.js と OCR の静的ファイル）だけ。
 * 原稿・コメントなどのデータ（Convex の WebSocket / HTTP）、ファイル取得 API（Workers）、署名付き URL、
 * 認証のやり取りは一切横取りせず、ブラウザにそのまま任せる（非公開の原稿を端末のキャッシュに残さない）。
 *
 * 更新: 新しい版は install までして待機する。画面の「更新」を押したときだけ SKIP_WAITING で切り替える
 * （書きかけの下書きがある画面を勝手に再読み込みしない）。
 */
const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const SHELL = `mf100-shell-${VERSION}`;
/**
 * キャッシュを先に見るファイル（中身が変わらない）。
 * - /assets/*（ハッシュ付き。遅延読み込みの画面・フォント）と /icons/* は版ごとの SHELL に入れ、版が変わったら古い版ごと消す
 * - /pdfjs/*・/ocr/*（PDF.js の文字データ、OCR の実行ファイルと学習データ。大きいが版で変わらない）は VENDOR に残す
 */
const SHELL_PREFIXES = ["/assets/", "/icons/"];
const VENDOR = "mf100-vendor-v1";
const VENDOR_PREFIXES = ["/pdfjs/", "/ocr/"];
/** 横取りしない同一オリジンのパス（API を同じオリジンに置いた場合に備える） */
const BYPASS_PREFIXES = ["/api/", "/auth/", "/.well-known/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("mf100-shell-") && k !== SHELL)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS_PREFIXES.some((p) => url.pathname.startsWith(p))) return;

  // 画面の移動: まずネットワーク（最新の index.html）。つながらないときだけキャッシュの外枠を返す（SPA なのでどのパスも index.html）
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches
          .open(SHELL)
          .then((c) => c.match("/index.html"))
          .then((r) => r || Response.error()),
      ),
    );
    return;
  }

  const cacheName = VENDOR_PREFIXES.some((p) => url.pathname.startsWith(p))
    ? VENDOR
    : SHELL_PREFIXES.some((p) => url.pathname.startsWith(p)) || PRECACHE.includes(url.pathname)
      ? SHELL
      : null;
  if (!cacheName) return;
  event.respondWith(
    caches.open(cacheName).then((cache) =>
      cache.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            // 正常な応答だけ保存する（範囲リクエストの 206・エラーは保存しない）
            if (res.ok && res.status === 200 && res.type === "basic")
              void cache.put(req, res.clone());
            return res;
          }),
      ),
    ),
  );
});
