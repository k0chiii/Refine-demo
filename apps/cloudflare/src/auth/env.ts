/**
 * 認証が読む環境変数。名前は Convex 側と同じ（移すときに値をそのまま持ってこられる）。
 * 秘密（wrangler secret）は wrangler types の Env に出ないので、ここで型だけ並べる。`Env` への足し込みは組み込む側がやる。
 * 全部 optional にしてあるのは、足りないときに型ではなく実行時に 500（auth_not_configured）で気づけるようにするため。
 */
export interface AuthEnv {
  /** Nogiku の OAuth クライアント */
  NOGIKU_CLIENT_ID?: string;
  NOGIKU_CLIENT_SECRET?: string;
  /** 例 https://auth.nogiku.jp/api。`${NOGIKU_ISSUER}/.well-known/openid-configuration` を読む */
  NOGIKU_ISSUER?: string;
  /** "true" のとき本物の OIDC ではなく POST /auth/mock だけが使える（デモ・E2E 用） */
  NOGIKU_MOCK_ENABLED?: string;
  /** 組織権限（Nogiku Access）。3 つ揃ったときだけ有効 */
  NOGIKU_ACCESS_API_URL?: string;
  NOGIKU_ACCESS_ORG_SLUG?: string;
  NOGIKU_ACCESS_SYSTEM_ID?: string;
  NOGIKU_ACCESS_ENABLED?: string;
  /** カンマ区切りの Nogiku sub。初回ログインで校正システム管理者にする */
  MF100_SYSTEM_ADMIN_SUBJECTS?: string;
  /** ログイン後に戻す Web の origin（パスがあってもよい） */
  FRONTEND_URL?: string;
  /** この Worker の origin。JWT の iss、OIDC の redirect_uri、JWKS の URL の元 */
  SITE_URL?: string;
  /** ES256 の秘密鍵（JWK を JSON で）。`node scripts/auth-keygen.mjs` で作る */
  AUTH_PRIVATE_KEY_JWK?: string;
}
