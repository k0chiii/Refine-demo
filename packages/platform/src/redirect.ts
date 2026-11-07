/**
 * ログイン後の遷移先（redirectTo）を検証して絶対 URL にする。
 * 前方一致だと `https://app.example.attacker.test/` が `https://app.example` に通ってしまうので、URL を解析して origin とパスの境界を比べる。
 * 許さないものは例外。
 */
export function resolveRedirectTo(redirectTo: string, frontendUrl: string): string {
  const base = new URL(frontendUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const reject = (): never => {
    throw new Error(`Invalid redirectTo: ${redirectTo}`);
  };
  // バックスラッシュ・制御文字・空白はブラウザごとに解釈が割れる
  // eslint-disable-next-line no-control-regex
  if (redirectTo === "" || /[\\\s\u0000-\u001f\u007f]/.test(redirectTo)) reject();

  let target: URL;
  if (redirectTo.startsWith("/")) {
    // 「//evil」はスキーム相対で別のサイトを指す
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
