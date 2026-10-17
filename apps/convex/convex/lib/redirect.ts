/**
 * ログイン後の遷移先（redirectTo）を検証して絶対 URL にする。
 * 文字列の前方一致では `https://app.example.attacker.test/` が `https://app.example` に一致してしまうため、
 * URL を解析して origin を厳密に比べ、FRONTEND_URL にパスがあればパスの境界も確かめる。
 * - 「/」1 個で始まる相対パス: FRONTEND_URL の下として扱う（「//evil」のようなスキーム相対は拒否）
 * - 絶対 URL: origin が FRONTEND_URL と同じで、パスが FRONTEND_URL のパスの下にあるものだけ
 * - バックスラッシュ・制御文字・空白を含むもの、javascript: などは拒否（ブラウザごとの解釈差を避ける）
 * 許可しないものは例外を投げる。
 */
export function resolveRedirectTo(redirectTo: string, frontendUrl: string): string {
  const base = new URL(frontendUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const reject = (): never => {
    throw new Error(`Invalid redirectTo: ${redirectTo}`);
  };
  // eslint-disable-next-line no-control-regex
  if (redirectTo === "" || /[\\\s\u0000-\u001f\u007f]/.test(redirectTo)) reject();

  let target: URL;
  if (redirectTo.startsWith("/")) {
    if (redirectTo.startsWith("//")) reject();
    target = parse(`${base.origin}${basePath}${redirectTo}`) ?? reject();
  } else {
    target = parse(redirectTo) ?? reject();
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") reject();
  if (target.origin !== base.origin) reject();
  if (target.username !== "" || target.password !== "") reject();
  if (
    basePath !== "" &&
    target.pathname !== basePath &&
    !target.pathname.startsWith(`${basePath}/`)
  )
    reject();
  return target.href;
}

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
