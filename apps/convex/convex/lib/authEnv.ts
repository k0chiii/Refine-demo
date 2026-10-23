/**
 * @convex-dev/auth はリダイレクト検証に `SITE_URL` を要求する。
 * 本アプリの正本は `FRONTEND_URL`（ログイン後の Web origin）なので、片方だけあるときは揃える。
 * どちらも無いと OAuth コールバックが Server Error になる。
 */
export function ensureAuthSiteUrl(env: NodeJS.ProcessEnv = process.env): void {
  const frontend = env.FRONTEND_URL?.replace(/\/$/, "");
  const site = env.SITE_URL?.replace(/\/$/, "");
  if (!site && frontend) env.SITE_URL = frontend;
  else if (!frontend && site) env.FRONTEND_URL = site;
}
