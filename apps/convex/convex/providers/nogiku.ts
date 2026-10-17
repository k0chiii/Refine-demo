import type { OAuthConfig, OAuthUserConfig } from "@auth/core/providers";
import { fetchOrgPermissions, type NogikuAccessConfig } from "../lib/nogikuAccess.ts";

/**
 * Nogiku Auth を Auth.js / Convex Auth の OIDC provider として扱う定義。
 *
 * 出典: MF99 UniQ `convex/providers/nogiku.ts`（実証済み実装）を MF100 向けに調整。
 * nogiku リポジトリ（develop）の `apps/auth/src/lib/auth/auth.ts` で確認した事実:
 *   - issuer は `${HOST}${BASE_PATH}/api`、discovery は `${issuer}/.well-known/openid-configuration`
 *   - スコープ: openid / profile / email / offline_access
 *   - userinfo の追加クレーム: hurigana, phoneNumber, generation, role（better-auth の admin ロール）
 *   - **現行 develop の userinfo に `roles[]`（system 単位の ACCESS/MANAGE）は含まれない**。
 *     UniQ が参照していた `roles` は旧版 Nogiku の仕様。MF100 は roles に依存しない。
 *   - 組織権限は Nogiku Access API（POST {apiUrl}/permission/check）で取得する。ユーザー本人の
 *     アクセストークンを Bearer に渡す。aud は Access API の URL、必要スコープは `{apiUrl}/permissions.read`。
 *     トークンの aud は認可リクエストの `resource={apiUrl}`（RFC 8707）で決まり、トークンリクエストには
 *     Nogiku Auth が認可リクエストの値を引き継ぐ。取得は lib/nogikuAccess.ts に閉じている。
 *
 * コールバック URL は `${CONVEX_SITE_URL}/api/auth/callback/nogiku`。Nogiku Auth 管理コンソールの
 * OAuth クライアントに redirect_uris として登録してもらう必要がある（Nogiku 管理者作業）。
 *
 * `idToken: false` は UniQ 同様に維持する: id_token は標準クレームのみで、hurigana 等は userinfo にしかない。
 */
export interface NogikuProfile extends Record<string, unknown> {
  sub: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  hurigana?: string;
  generation?: number;
  role?: string;
}

export type NogikuOAuthProfile = {
  id: string;
  /**
   * Convex Auth は profile の `id` を取り除いて createOrUpdateUser に渡すため、本物の OIDC 経路では
   * `sub` でしか subject を受け取れない。
   */
  sub: string;
  name?: string;
  email?: string;
  image?: string;
  hurigana?: string;
  generation?: number;
  /** 取得できた組織権限名。undefined は「取得しなかった／失敗した」で、保存値を変えない。 */
  orgPermissions?: string[];
};

export default function Nogiku<P extends NogikuProfile>(
  options: OAuthUserConfig<P>,
  access?: NogikuAccessConfig,
): OAuthConfig<P> {
  return {
    id: "nogiku",
    name: "NOGIKU",
    type: "oidc",
    authorization: {
      params: access
        ? {
            scope: `openid profile email ${access.apiUrl}/permissions.read`,
            resource: access.apiUrl,
          }
        : { scope: "openid profile email" },
    },
    checks: ["pkce", "state", "nonce"],
    idToken: false,
    async profile(profile: NogikuProfile, tokens: { access_token?: string }) {
      const result: NogikuOAuthProfile = { id: profile.sub, sub: profile.sub };
      if (profile.name !== undefined) result.name = profile.name;
      if (profile.email !== undefined) result.email = profile.email.toLowerCase();
      if (profile.picture !== undefined) result.image = profile.picture;
      if (typeof profile.hurigana === "string") result.hurigana = profile.hurigana;
      if (typeof profile.generation === "number") result.generation = profile.generation;
      if (access && tokens.access_token) {
        const orgPermissions = await fetchOrgPermissions(access, tokens.access_token);
        if (orgPermissions !== undefined) result.orgPermissions = orgPermissions;
      }
      return result as unknown as Awaited<ReturnType<NonNullable<OAuthConfig<P>["profile"]>>>;
    },
    options,
  } as unknown as OAuthConfig<P>;
}
