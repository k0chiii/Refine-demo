import { workersAi } from "./workersAi";
import { createAccessVerifier } from "./adapters/accessVerifier.ts";
import { createConvexCleanupGateway } from "./adapters/convexCleanupGateway.ts";
import { createConvexGateway } from "./adapters/convexGateway.ts";
import { createFigmaClient } from "./adapters/figmaClient.ts";
import { createJoseVerifier } from "./adapters/joseVerifier.ts";
import { createR2Store } from "./adapters/r2Store.ts";
import { observeStore } from "./storeTelemetry.ts";
import { createApp } from "./app.ts";
import { purgeOrphanObjects } from "./cleanup.ts";
import type { Bindings } from "./env.ts";

/**
 * JWT の検証器は isolate の中で使い回す。リクエストごとに作ると jose の JWKS の写し（既定 10 分）が毎回空になり、
 * 全リクエスト（PDF.js の範囲取得は 1 ファイルで何本も）が Convex の /.well-known/jwks.json を取りに行って待たされる
 */
const accessVerifiers = new Map<string, ReturnType<typeof createAccessVerifier>>();
const verifiers = new Map<string, ReturnType<typeof createJoseVerifier>>();
function verifierFor(siteUrl: string) {
  let v = verifiers.get(siteUrl);
  if (!v) {
    v = createJoseVerifier(siteUrl);
    verifiers.set(siteUrl, v);
  }
  return v;
}

/** Workers エントリ。環境ごとに依存を組み立てて Hono アプリに注入する。 */
export default {
  fetch: handleRequest,

  /** cron（wrangler.jsonc の triggers）: 放置セッションの孤立 R2 オブジェクトを削除する（D14）。 */
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    if (!env.MF100_CLEANUP_SECRET) {
      console.warn("MF100_CLEANUP_SECRET が未設定のため R2 清掃をスキップしました");
      return;
    }
    ctx.waitUntil(
      purgeOrphanObjects({
        gateway: createConvexCleanupGateway(env.CONVEX_SITE_URL, env.MF100_CLEANUP_SECRET),
        store: createR2Store(env.ASSETS),
      }).then((r) => console.log("r2 cleanup", JSON.stringify(r))),
    );
  },
};

export async function handleRequest(
  request: Request,
  env: Bindings,
  ctx: ExecutionContext,
  processing?: (request: Request, token: string) => Promise<Response>,
): Promise<Response> {
  if (["/internal/ai/proofread", "/internal/ai/embed"].includes(new URL(request.url).pathname))
    return workersAi(request, {
      ...(env.AI ? { AI: env.AI } : {}),
      ...(env.WORKERS_AI_SECRET ? { secret: env.WORKERS_AI_SECRET } : {}),
      ...(env.WORKERS_AI_MODEL ? { model: env.WORKERS_AI_MODEL } : {}),
    });
  if (Boolean(env.ACCESS_TEAM) !== Boolean(env.ACCESS_AUDIENCE))
    throw new Error("Both Access team and audience must be configured");
  const accessKey = JSON.stringify([env.ACCESS_TEAM, env.ACCESS_AUDIENCE]);
  if (env.ACCESS_TEAM && env.ACCESS_AUDIENCE && !accessVerifiers.has(accessKey))
    accessVerifiers.set(accessKey, createAccessVerifier(env.ACCESS_TEAM, env.ACCESS_AUDIENCE));
  const requestId = crypto.randomUUID();
  const app = createApp({
    requestId,
    ...(processing ? { processing } : {}),
    multipartBucket: env.ASSETS,
    ...(accessVerifiers.has(accessKey) ? { authorizeAccess: accessVerifiers.get(accessKey)! } : {}),
    allowExpensiveRequest: async (subject, operation) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject));
      const key =
        operation +
        ":" +
        Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      return (await env.EXPENSIVE_REQUESTS.limit({ key })).success;
    },
    reportRequest: (metric) => console.log(JSON.stringify(metric)),
    verifier: verifierFor(env.CONVEX_SITE_URL),
    gateway: createConvexGateway({
      convexUrl: env.CONVEX_URL,
      siteUrl: env.CONVEX_SITE_URL,
      uploadSecret: env.MF100_UPLOAD_SECRET,
      requestId,
    }),
    store: observeStore(createR2Store(env.ASSETS), requestId, (metric) =>
      console.log(JSON.stringify(metric)),
    ),
    allowedOrigins: env.ALLOWED_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    // Figma はトークン（秘密）があるときだけ。ブラウザに渡さず、この Worker からだけ呼ぶ
    figma: env.FIGMA_ACCESS_TOKEN ? createFigmaClient(env.FIGMA_ACCESS_TOKEN) : null,
  });
  const pathname = new URL(request.url).pathname;
  if (
    env.STATIC_ASSETS &&
    ["GET", "HEAD"].includes(request.method) &&
    !/^\/(health|files|uploads|comment-files|figma|processing|internal)(\/|$)/.test(pathname)
  ) {
    const access = accessVerifiers.get(accessKey);
    if (access && !(await access(request))) return new Response(null, { status: 403 });
    return env.STATIC_ASSETS.fetch(request);
  }
  return app.fetch(request, env, ctx);
}
