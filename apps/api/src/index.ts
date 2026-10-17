import { createConvexCleanupGateway } from "./adapters/convexCleanupGateway.ts";
import { createConvexGateway } from "./adapters/convexGateway.ts";
import { createFigmaClient } from "./adapters/figmaClient.ts";
import { createJoseVerifier } from "./adapters/joseVerifier.ts";
import { createR2Store } from "./adapters/r2Store.ts";
import { createApp } from "./app.ts";
import { purgeOrphanObjects } from "./cleanup.ts";
import type { Bindings } from "./env.ts";

/** Workers エントリ。環境ごとに依存を組み立てて Hono アプリに注入する。 */
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const app = createApp({
      verifier: createJoseVerifier(env.CONVEX_SITE_URL),
      gateway: createConvexGateway({
        convexUrl: env.CONVEX_URL,
        siteUrl: env.CONVEX_SITE_URL,
        uploadSecret: env.MF100_UPLOAD_SECRET,
      }),
      store: createR2Store(env.ASSETS),
      allowedOrigins: env.ALLOWED_ORIGINS.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      // Figma はトークン（秘密）があるときだけ。ブラウザに渡さず、この Worker からだけ呼ぶ
      figma: env.FIGMA_ACCESS_TOKEN ? createFigmaClient(env.FIGMA_ACCESS_TOKEN) : null,
    });
    return app.fetch(request, env, ctx);
  },

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
