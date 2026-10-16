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

/*
 * 端末への通知（Web Push。利用者決定 2026-10-15）。
 * 本文は Convex（pushNode.deliver）が端末の鍵で暗号化して送り、ブラウザが復号して渡す。
 * 中身は題名・制作物名・開く画面・未読の数だけ（コメントの抜粋などは載せない）。
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "MF100 校正システム";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
  const tasks = [
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icons/icon-192.png",
      lang: "ja",
      data: { url, id: typeof data.tag === "string" ? data.tag : null },
    }),
  ];
  // アプリのアイコンの数（iOS 16.4+・Chrome/Edge のインストール済みアプリ）
  if (typeof data.badge === "number" && "setAppBadge" in self.navigator)
    tasks.push(
      (data.badge > 0
        ? self.navigator.setAppBadge(data.badge)
        : self.navigator.clearAppBadge()
      ).catch(() => {}),
    );
  event.waitUntil(Promise.all(tasks));
});

/** 通知を押したら、開いている画面があればそこで、無ければ新しく開く（押した通知は既読にする: ?from_notification=） */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(typeof data.url === "string" ? data.url : "/", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      // アプリが端末から出した通知（確認・デモ）: 開いているアプリに画面の移動を頼む（読み込み直さない）
      if (data.inApp && open) {
        open.postMessage({
          type: "mf100-notification-open",
          url: target.pathname + target.search,
          id: data.id ?? null,
        });
        return open.focus();
      }
      if (data.id) target.searchParams.set("from_notification", data.id);
      if (open && "navigate" in open)
        return open.navigate(target.href).then((c) => (c || open).focus());
      return self.clients.openWindow(target.href);
    }),
  );
});
