import { createConvexGateway } from "./adapters/convexGateway.ts";
import { createJoseVerifier } from "./adapters/joseVerifier.ts";
import { createR2Store } from "./adapters/r2Store.ts";
import { createApp } from "./app.ts";
import type { Bindings } from "./env.ts";

/** Workers エントリ。環境ごとに依存を組み立てて Hono アプリに注入する。 */
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const app = createApp({
      verifier: createJoseVerifier(env.CONVEX_SITE_URL),
      gateway: createConvexGateway(env.CONVEX_URL),
      store: createR2Store(env.ASSETS),
      allowedOrigins: env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    });
    return app.fetch(request, env, ctx);
  },
};
