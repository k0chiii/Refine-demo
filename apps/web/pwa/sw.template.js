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

/**
 * 新しい版の外枠を用意する。/assets/* はファイル名にハッシュが入っていて、同じ名前なら中身も同じなので、
 * 前の版のキャッシュにあるものはそこから写し、通信しない（リリースで変わるのは数本のチャンクだけ。
 * 以前は 250 本あまり・合計 6MB 超を毎回すべて取り直していた）。それ以外（index.html・マニフェスト・アイコン）は必ず取り直す。
 * 前の版が無い（初回）、写せなかったときは、これまでどおり通信で取る。
 */
async function precache() {
  const cache = await caches.open(SHELL);
  const olds = [];
  try {
    for (const k of await caches.keys())
      if (k.startsWith("mf100-shell-") && k !== SHELL) olds.push(await caches.open(k));
  } catch {
    // 前の版が読めなければ全部通信で取る
  }
  await Promise.all(
    PRECACHE.map(async (p) => {
      if (p.startsWith("/assets/")) {
        for (const old of olds) {
          // Vary（配信側が Origin などを付けていると、画面からの要求で入れ直したものに合わなくなる）は無視する: 名前が同じなら中身は同じ
          const hit = await old.match(p, { ignoreVary: true }).catch(() => undefined);
          if (hit && hit.ok && hit.status === 200) {
            await cache.put(p, hit);
            return;
          }
        }
      }
      await cache.add(new Request(p, { cache: "reload" }));
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precache()
      // 開いているアプリの画面が無ければ待たずに切り替える（書きかけの画面が無いので再読み込みの心配が無い）。
      // 画面が開けない版（下の unredirected の修正前）を入れた端末は「更新」を押せないため、ここで入れ替わる
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((wins) => (wins.length === 0 ? self.skipWaiting() : undefined)),
  );
});

/**
 * リダイレクトを経た応答は、画面の移動（navigate）の応答に使えない（ブラウザが
 * 「Response served by service worker has redirections」で読み込みを止める）。
 * Cloudflare Pages は /index.html を / へリダイレクトするので、キャッシュの外枠は作り直してから返す
 */
async function unredirected(res) {
  if (!res || !res.redirected) return res;
  return new Response(await res.blob(), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

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

  // 画面の移動: 版ごとの外枠（index.html）をキャッシュからすぐ返す（SPA なのでどのパスも同じ index.html）。
  // 以前はネットワーク優先で、毎回 index.html の応答（実測 0.6 秒前後）を待ってから JS の読み込みが始まっていた。
  // index.html は precache にある JS・CSS と同じ版のものなので、組み合わせは常に揃う。新しい版は待機させ、
  // 画面の「更新」を押したときに切り替える（上の更新の方針どおり）。キャッシュに無いときだけネットワーク
  // 対象はアプリの画面を開く移動（destination が document。iframe・拡張子つきのファイル・デモのサイトは含めない）
  if (req.mode === "navigate") {
    const isAppScreen =
      req.destination === "document" &&
      !/\.[A-Za-z0-9]+$/.test(url.pathname) &&
      !url.pathname.startsWith("/demo-site/");
    event.respondWith(
      isAppScreen
        ? caches
            .open(SHELL)
            .then((c) => c.match("/index.html"))
            .then((hit) => (hit ? unredirected(hit) : fetch(req)))
            .catch(() => Response.error())
        : // それ以外は従来どおりネットワーク優先（つながらないときだけ外枠）
          fetch(req).catch(() =>
            caches
              .open(SHELL)
              .then((c) => c.match("/index.html"))
              .then((r) => (r ? unredirected(r) : Response.error())),
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
 * 端末への通知（Web Push。利用者決定 2026-10-15。普通のアプリの見た目に: 利用者指示 2026-10-18）。
 * 本文は Convex（pushNode.deliver）が端末の鍵で暗号化して送り、ブラウザが復号して渡す。
 * 中身は題名（制作物名）・本文（送り主と抜粋）・開く画面・未読の数・通知の時刻。利用者が「通知に内容を表示」を切っていれば、
 * 送り主と抜粋は届かない（サーバーで作る時点で外れている）。
 * - 同じ会話（tag = スレッド → 制作物 → 通知の ID）の通知は 1 つに置き換わり、「N件の新着」と最新の 1 行を出す
 * - アプリを開いて見ている間は、音と振動を出さずに出す（Chrome・iOS は通知を出さない push を許さないため、出すこと自体はやめない）
 */
const NOTIFICATION_ICON = "/icons/icon-192.png";
/** Android のステータスバーに出す単色の小さなアイコン（白と透明） */
const NOTIFICATION_BADGE = "/icons/badge-96.png";
/** まとめた通知に残す行と通知の ID の上限 */
const MERGE_LINES = 5;
const MERGE_IDS = 20;

const isText = (v) => typeof v === "string" && v.length > 0;

/** 同じ印の通知がすでに出ていれば、その内容（まとめるために data に持たせた行・ID・件数）を返す */
async function shownWithTag(tag) {
  if (!tag) return null;
  try {
    const list = await self.registration.getNotifications({ tag });
    const prev = list.find((n) => n.data && Array.isArray(n.data.lines));
    return prev || null;
  } catch {
    return null;
  }
}

/** この画面の持ち主のアプリを、いま見ている最中か（前面で、表示されている） */
async function appInFront() {
  try {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    return list.some(
      (c) =>
        new URL(c.url).origin === self.location.origin &&
        c.focused &&
        c.visibilityState === "visible",
    );
  } catch {
    return false;
  }
}

async function showPush(data) {
  const url = isText(data.url) && data.url.startsWith("/") ? data.url : "/";
  const tag = isText(data.tag) ? data.tag : undefined;
  const id = isText(data.id) ? data.id : (tag ?? null);
  const line = typeof data.body === "string" ? data.body : "";
  const timestamp =
    typeof data.createdAt === "number" && data.createdAt > 0 ? data.createdAt : Date.now();
  let title = isText(data.title) ? data.title : "MF100 校正システム";
  let body = line;
  let lines = [line];
  let ids = id ? [id] : [];
  let count = 1;

  const prev = await shownWithTag(tag);
  if (prev) {
    // 題名はそのまま、本文は最新の 1 行に「N件の新着」を付ける
    title = prev.title || title;
    lines = [...prev.data.lines, line].slice(-MERGE_LINES);
    ids = [...(Array.isArray(prev.data.ids) ? prev.data.ids : []), ...ids].slice(-MERGE_IDS);
    count = (typeof prev.data.count === "number" ? prev.data.count : prev.data.lines.length) + 1;
    body = `${count}件の新着: ${line}`;
  }

  const quiet = await appInFront();
  await self.registration.showNotification(title, {
    body,
    // 同じ印の通知は置き換える。renotify: 置き換えでも知らせる（印があるときだけ指定できる）
    ...(tag ? { tag, renotify: !quiet } : {}),
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    timestamp,
    lang: "ja",
    silent: quiet,
    data: { url, id, ids, lines, count },
  });
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const tasks = [showPush(data)];
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
      // まとめた通知は、含まれる通知をすべて既読にする（カンマ区切り。画面側で分ける）
      const ids = Array.isArray(data.ids) && data.ids.length ? data.ids : data.id ? [data.id] : [];
      if (ids.length) target.searchParams.set("from_notification", ids.join(","));
      if (open && "navigate" in open)
        return open.navigate(target.href).then((c) => (c || open).focus());
      return self.clients.openWindow(target.href);
    }),
  );
});
