import type { OAuthConfig, OAuthUserConfig } from "@auth/core/providers";

/**
 * Nogiku Auth を Auth.js / Convex Auth の OIDC provider として扱う定義。
 *
 * 出典: MF99 UniQ `convex/providers/nogiku.ts`（実証済み実装）を MF100 向けに調整。
 * nogiku リポジトリ（develop）の `apps/auth/src/lib/auth/auth.ts` で確認した事実:
 *   - issuer は `${HOST}${BASE_PATH}/api`、discovery は `${issuer}/.well-known/openid-configuration`
 *   - スコープ: openid / profile / email / offline_access
 *   - userinfo の追加クレーム: hurigana, phoneNumber, generation, role（better-auth の admin ロール）
 *   - **現行 develop の userinfo に `roles[]`（system 単位の ACCESS/MANAGE）は含まれない**。
 *     UniQ が参照していた `roles` は旧版 Nogiku の仕様。MF100 は roles に依存せず、組織権限は
 *     Nogiku Access API（POST /permission/check, 要 resource 指定アクセストークン）経由で後続対応する。
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
  name?: string;
  email?: string;
  image?: string;
  hurigana?: string;
  generation?: number;
};

export default function Nogiku<P extends NogikuProfile>(options: OAuthUserConfig<P>): OAuthConfig<P> {
  return {
    id: "nogiku",
    name: "NOGIKU",
    type: "oidc",
    authorization: { params: { scope: "openid profile email" } },
    checks: ["pkce", "state", "nonce"],
    idToken: false,
    profile(profile: NogikuProfile) {
      const result: NogikuOAuthProfile = { id: profile.sub };
      if (profile.name !== undefined) result.name = profile.name;
      if (profile.email !== undefined) result.email = profile.email.toLowerCase();
      if (profile.picture !== undefined) result.image = profile.picture;
      if (typeof profile.hurigana === "string") result.hurigana = profile.hurigana;
      if (typeof profile.generation === "number") result.generation = profile.generation;
      return result as unknown as Awaited<ReturnType<NonNullable<OAuthConfig<P>["profile"]>>>;
    },
    options,
  } as unknown as OAuthConfig<P>;
}
