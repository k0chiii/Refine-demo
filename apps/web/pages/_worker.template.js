/* global HTMLRewriter */
/* Cloudflare Pages の Worker（advanced mode。ビルド時に vite.config.ts の ogWorker() が dist/_worker.js として書き出す。
 * 受け持つのは _routes.json の `/works/*` だけで、ほかの静的ファイルはこの Worker を通らない）。
 *
 * 役目: 制作物のリンク（/works/:id とその下）を Slack などに貼ったときのプレビュー（OGP）に、制作物の題名を出す
 * （利用者決定 2026-10-24「題名は出していいよ」。docs/DECISIONS.md「制作物ごとの OGP」）。
 * 取得はサインインしていないので、Convex の公開の応答 `GET /og/work?id=`（機密区分が通常の制作物の題名だけ）を引き、
 * SPA の外枠（index.html）の `og:title` と `<title>` を差し替えて返す。題名が無ければ（非公開・無い ID・取れない）外枠をそのまま返す。
 * 画面の中身は変えない（アプリは今までどおり読み込み後に document.title を付け直す）。
 */
const CONVEX_SITE_URL = __CONVEX_SITE_URL__;
const APP_NAME = "MF100 校正システム";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = /^\/works\/([A-Za-z0-9_-]{1,64})(?:\/|$)/.exec(url.pathname);
    if (!m || (request.method !== "GET" && request.method !== "HEAD"))
      return env.ASSETS.fetch(request);
    // SPA の外枠（/ は index.html）。/works/:id 自体は静的ファイルが無いので、明示的に外枠を取る
    const shell = await env.ASSETS.fetch(new Request(new URL("/", url), request));
    if (!(shell.headers.get("content-type") ?? "").includes("text/html")) return shell;
    const title = await workTitle(m[1]);
    if (!title) return shell;
    return new HTMLRewriter()
      .on('meta[property="og:title"]', {
        element(el) {
          el.setAttribute("content", title);
        },
      })
      .on("title", {
        element(el) {
          el.setInnerContent(`${title} – ${APP_NAME}`);
        },
      })
      .transform(shell);
  },
};

/** 制作物の題名（通常の制作物だけ。5 分は Cloudflare のキャッシュから）。取れないときは null（プレビューはアプリの名前のまま） */
async function workTitle(id) {
  if (!CONVEX_SITE_URL) return null;
  try {
    const res = await fetch(`${CONVEX_SITE_URL}/og/work?id=${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(1500),
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.title === "string" && body.title.trim() ? body.title.trim() : null;
  } catch {
    return null;
  }
}
