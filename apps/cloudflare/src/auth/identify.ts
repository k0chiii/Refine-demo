import type { AuthEnv } from "./env.ts";
import { createJwt, type AccessClaims } from "./jwt.ts";

export type JwtIdentify = (request: Request) => Promise<AccessClaims | null>;

/**
 * `Authorization: Bearer <access token>` から本人を読む。発行したのと同じ鍵で検証するので、JWKS を取りに行かない。
 * 鍵の読み込みはこの関数の寿命ぶん 1 度だけ。リクエストごとに作らず、isolate で使い回す
 */
export function jwtIdentifier(
  env: Pick<AuthEnv, "AUTH_PRIVATE_KEY_JWK" | "SITE_URL">,
  now?: () => number,
): JwtIdentify {
  const jwt = createJwt({
    privateKeyJwk: env.AUTH_PRIVATE_KEY_JWK ?? "",
    issuer: env.SITE_URL ?? "",
    ...(now ? { now } : {}),
  });
  return async (request) => {
    const header = request.headers.get("Authorization");
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    return match?.[1] ? jwt.verifyAccessToken(match[1]) : null;
  };
}
