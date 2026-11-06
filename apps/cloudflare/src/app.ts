import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Identify } from "./identity.ts";
import { isUsecaseName } from "./registry.ts";
import { statusOf, type RunResult } from "./run.ts";

export interface AppDeps {
  identify: Identify;
  /** 業務データの正本（Durable Object）。テストは SQLite を直に包んだ偽物を渡す */
  db(): {
    run(
      identity: { subject: string; email?: string; name?: string },
      name: string,
      args: unknown[],
    ): Promise<RunResult>;
    fetch(request: Request): Promise<Response>;
  };
  allowedOrigins: readonly string[];
}

/**
 * HTTP の境界。ここでは「誰か」と「どのユースケースか」だけを決め、業務は Durable Object の中の application に任せる。
 * - POST /u/:name  body { args: [...] } → usecase(ctx, principal, ...args)
 * - GET  /ws       変更の通知（書いたテーブルの名前）を WebSocket で配る。Convex の購読の代わり（粒度はテーブル）
 */
export function createApp(deps: AppDeps) {
  const app = new Hono()
    .use(
      "*",
      cors({
        origin: (origin) => (deps.allowedOrigins.includes(origin) ? origin : null),
        allowHeaders: ["Content-Type", "X-MF100-Identity", "Cf-Access-Jwt-Assertion"],
      }),
    )
    .get("/health", (c) => c.json({ ok: true }))
    .get("/ws", async (c) => {
      if (c.req.header("Upgrade") !== "websocket") return c.text("Expected WebSocket", 426);
      if (!(await deps.identify(c.req.raw))) return c.text("Unauthorized", 401);
      return deps.db().fetch(c.req.raw);
    })
    .post("/u/:name", async (c) => {
      const identity = await deps.identify(c.req.raw);
      if (!identity) return c.json({ code: "unauthenticated", details: {} }, 401);
      const name = c.req.param("name");
      if (!isUsecaseName(name))
        return c.json({ code: "usecase_not_found", details: { name } }, 404);
      const body: unknown = await c.req.json().catch(() => null);
      const args =
        body && typeof body === "object" && Array.isArray((body as { args?: unknown }).args)
          ? (body as { args: unknown[] }).args
          : null;
      if (!args)
        return c.json({ code: "invalid_body", details: { expected: "{ args: [] }" } }, 400);
      const result = await deps.db().run(identity, name, args);
      if (result.ok) return c.json(result.value ?? null);
      return c.json({ code: result.code, details: result.details }, statusOf(result.code));
    });
  return app;
}

export type AppType = ReturnType<typeof createApp>;
