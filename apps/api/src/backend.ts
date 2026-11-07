import { createCloudflareCleanupGateway } from "./adapters/cloudflareCleanupGateway.ts";
import { createCloudflareGateway } from "./adapters/cloudflareGateway.ts";
import { createConvexCleanupGateway } from "./adapters/convexCleanupGateway.ts";
import { createConvexGateway } from "./adapters/convexGateway.ts";
import { createJoseVerifier } from "./adapters/joseVerifier.ts";
import { backendSiteUrl, type Bindings } from "./env.ts";
import type { BackendGateway, CleanupGateway, TokenVerifier } from "./ports.ts";

/**
 * JWT の検証器は isolate の中で使い回す。リクエストごとに作ると jose の JWKS の写し（既定 10 分）が毎回空になり、
 * 全リクエスト（PDF.js の範囲取得は 1 ファイルで何本も）が JWKS を取りに行って待たされる
 */
const verifiers = new Map<string, TokenVerifier>();
function verifierFor(siteUrl: string) {
  let v = verifiers.get(siteUrl);
  if (!v) {
    v = createJoseVerifier(siteUrl);
    verifiers.set(siteUrl, v);
  }
  return v;
}

/**
 * BACKEND（既定 convex）で業務の正本を切り替える。JWT は aud = "convex" のまま、issuer と JWKS だけ向き先に合わせる
 * （apps/cloudflare も同じ aud・iss = SITE_URL で発行するので、検証側の差は URL だけ）
 */
export function createBackend(
  env: Bindings,
  requestId: string,
): { verifier: TokenVerifier; gateway: BackendGateway } {
  const siteUrl = backendSiteUrl(env);
  return {
    verifier: verifierFor(siteUrl),
    gateway:
      env.BACKEND === "cloudflare"
        ? createCloudflareGateway({ siteUrl, uploadSecret: env.MF100_UPLOAD_SECRET, requestId })
        : createConvexGateway({
            convexUrl: env.CONVEX_URL,
            siteUrl,
            uploadSecret: env.MF100_UPLOAD_SECRET,
            requestId,
          }),
  };
}

export function createCleanup(env: Bindings, secret: string): CleanupGateway {
  const siteUrl = backendSiteUrl(env);
  return env.BACKEND === "cloudflare"
    ? createCloudflareCleanupGateway(siteUrl, secret)
    : createConvexCleanupGateway(siteUrl, secret);
}
