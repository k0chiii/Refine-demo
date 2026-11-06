/**
 * Convex Auth の JWT から利用者を表す文字列を取り出す（端末の写しの持ち主の判別にだけ使う。署名の検証はしない。認可はサーバー）。
 * `sub` は「利用者 ID|セッション ID」。セッションはサインインごとに替わるので、利用者 ID の部分だけを使う。
 * 読めないトークンは、トークン全体を持ち主の代わりにする（別の利用者と混ざらない側に倒す）
 */
export function jwtUser(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (!payload) return token;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    if (typeof sub === "string" && sub) return sub.split("|")[0]!;
  } catch {
    // 読めない
  }
  return token;
}
