import { decodeJwt } from "jose";
import { fetchOrgPermissions, type NogikuAccessConfig } from "./access.ts";
import { randomToken, sha256Base64url, type AuthProfile } from "./store.ts";

/**
 * Nogiku への Authorization Code + PKCE + state + nonce（apps/convex の providers/nogiku.ts と同じ組み立て）。
 * - scope は openid profile email。組織権限を取るときは `${apiUrl}/permissions.read` と resource=apiUrl を足す
 * - プロフィールは id_token ではなく userinfo から読む（hurigana などは userinfo にしか無い）
 * - 組織権限は /permission/check。取れなくても落とさない
 */
export interface OidcConfig {
  clientId: string;
  clientSecret: string;
  /** 末尾スラッシュは気にしない */
  issuer: string;
  /** `${SITE_URL}/auth/callback`。Nogiku の OAuth クライアントに登録してもらう */
  redirectUri: string;
  access?: NogikuAccessConfig | undefined;
}

export class OidcError extends Error {}

export interface Authorization {
  url: string;
  state: string;
  verifier: string;
  nonce: string;
}

export interface Oidc {
  authorize(): Promise<Authorization>;
  exchange(input: { code: string; verifier: string; nonce: string }): Promise<AuthProfile>;
}

/** 外への通信が固まったままログインを止めないための上限 */
const TIMEOUT_MS = 10_000;

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function createOidc(
  config: OidcConfig,
  fetchImpl: typeof fetch,
  now: () => number = Date.now,
): Oidc {
  const issuer = trimSlash(config.issuer);

  const call = async (input: string, init: RequestInit = {}): Promise<unknown> => {
    const res = await fetchImpl(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new OidcError(`${input} returned ${res.status}`);
    return res.json();
  };

  // ponytail: discovery は呼ぶたびに取りに行く（ログインのときだけなので）。遅ければ isolate で持つ
  const discover = async (): Promise<Discovery> => {
    const doc = (await call(`${issuer}/.well-known/openid-configuration`)) as Partial<Discovery>;
    const { authorization_endpoint: a, token_endpoint: t, userinfo_endpoint: u } = doc;
    if (typeof a !== "string" || typeof t !== "string" || typeof u !== "string")
      throw new OidcError("discovery document is missing endpoints");
    return { authorization_endpoint: a, token_endpoint: t, userinfo_endpoint: u };
  };

  return {
    async authorize() {
      const { authorization_endpoint } = await discover();
      const state = randomToken();
      const nonce = randomToken();
      const verifier = randomToken();
      const url = new URL(authorization_endpoint);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: config.access
          ? `openid profile email ${config.access.apiUrl}/permissions.read`
          : "openid profile email",
        state,
        nonce,
        code_challenge: await sha256Base64url(verifier),
        code_challenge_method: "S256",
        // 組織権限の API 向けのトークンにしてもらう（RFC 8707）。token の側は認可リクエストの値を引き継ぐ
        ...(config.access ? { resource: config.access.apiUrl } : {}),
      }).toString();
      return { url: url.href, state, verifier, nonce };
    },

    async exchange({ code, verifier, nonce }) {
      const { token_endpoint, userinfo_endpoint } = await discover();
      // client_secret_basic（Auth.js の既定）。id と secret は form 形式でエスケープしてから Basic にする
      const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
      const basic = btoa(`${enc(config.clientId)}:${enc(config.clientSecret)}`);
      const tokens = (await call(token_endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
          code_verifier: verifier,
        }),
      })) as { access_token?: unknown; id_token?: unknown };
      if (typeof tokens.access_token !== "string" || typeof tokens.id_token !== "string")
        throw new OidcError("token response has no access_token / id_token");

      // id_token は token endpoint から TLS で直接受け取ったものなので、署名は見ない（OIDC Core 3.1.3.7）。
      // nonce は「この認可リクエストへの応答か」を確かめるために見る
      const idToken = decodeJwt(tokens.id_token);
      const audiences = Array.isArray(idToken.aud) ? idToken.aud : [idToken.aud];
      if (
        idToken.nonce !== nonce ||
        trimSlash(idToken.iss ?? "") !== issuer ||
        !audiences.includes(config.clientId) ||
        (idToken.exp ?? 0) * 1000 <= now()
      )
        throw new OidcError("id_token does not match this authorization request");

      const info = (await call(userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })) as Record<string, unknown>;
      // userinfo の sub が id_token と違うなら、別の人のプロフィールを受け取ったことになる
      if (typeof info.sub !== "string" || info.sub !== idToken.sub)
        throw new OidcError("userinfo sub does not match id_token sub");

      const profile: AuthProfile = { sub: info.sub };
      if (typeof info.name === "string") profile.name = info.name;
      if (typeof info.email === "string") profile.email = info.email.toLowerCase();
      if (typeof info.picture === "string") profile.picture = info.picture;
      if (typeof info.hurigana === "string") profile.hurigana = info.hurigana;
      if (typeof info.generation === "number") profile.generation = info.generation;
      if (config.access) {
        const orgPermissions = await fetchOrgPermissions(
          config.access,
          tokens.access_token,
          fetchImpl,
        );
        if (orgPermissions !== undefined) profile.orgPermissions = orgPermissions;
      }
      return profile;
    },
  };
}
