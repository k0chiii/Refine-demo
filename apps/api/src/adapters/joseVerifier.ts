import { createRemoteJWKSet, jwtVerify } from "jose";
import type { TokenVerifier } from "../ports.ts";

/**
 * Convex Auth が発行する JWT の検証。
 * issuer = CONVEX_SITE_URL、audience = "convex"（convex/auth.config.ts の applicationID と一致）。
 * JWKS は `${CONVEX_SITE_URL}/.well-known/jwks.json`。
 */
export function createJoseVerifier(convexSiteUrl: string): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", convexSiteUrl));
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: convexSiteUrl,
          audience: "convex",
        });
        return typeof payload.sub === "string" ? { subject: payload.sub } : null;
      } catch {
        return null;
      }
    },
  };
}
