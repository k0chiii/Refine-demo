import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ServiceSecret } from "./functions/define.ts";
import { findFunction } from "./functions/index.ts";
import type { Identify, Identity } from "./identity.ts";
import { statusOf, type CallResult } from "./run.ts";
import { verifyServiceSecret } from "./serviceAuth.ts";
import { authApp, type AuthDeps } from "./auth/app.ts";

export interface AppDeps {
  identify: Identify;
  /** 業務データの正本（Durable Object）。テストは SQLite を直に包んだ偽物を渡す */
  db(): {
    call(
      name: string,
      identity: Identity | null,
      args: unknown,
      serviceOk: boolean,
    ): Promise<CallResult>;
    fetch(request: Request): Promise<Response>;
  };
  /** サービス間の共有秘密（wrangler secret）。未設定なら undefined */
  secret(name: ServiceSecret): string | undefined;
  allowedOrigins: readonly string[];
  /** 認証（src/auth）。store は Durable Object 越し。テストは SQLite を直に包んだものを渡す */
  auth: Pick<AuthDeps, "store" | "env" | "fetch" | "now">;
}

const notFound = (name: string) => ({ code: "function_not_found", details: { name } });

/**
 * HTTP の境界。ここでは「誰か」「どの関数か」「引数の形」だけを決め、業務は Durable Object の中の関数に任せる。
 * - POST /f/:name  body は引数の object そのもの（Convex の args と同じ）。名前は Convex の getFunctionName と同じ `works:create`
 * - GET  /ws       変更の通知（書いたテーブルの名前）を WebSocket で配る。Convex の購読の代わり（粒度はテーブル）
 */
export function createApp(deps: AppDeps) {
  const app = new Hono()
    .use(
      "*",
      cors({
        origin: (origin) => (deps.allowedOrigins.includes(origin) ? origin : null),
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "X-MF100-Identity",
          "Cf-Access-Jwt-Assertion",
        ],
      }),
    )
    .route("/", authApp(deps.auth))
    .get("/health", (c) => c.json({ ok: true }))
    .get("/ws", async (c) => {
      if (c.req.header("Upgrade") !== "websocket") return c.text("Expected WebSocket", 426);
      if (!(await deps.identify(c.req.raw))) return c.text("Unauthorized", 401);
      return deps.db().fetch(c.req.raw);
    })
    .post("/f/:name", async (c) => {
      const name = c.req.param("name");
      const def = findFunction(name);
      if (!def) return c.json(notFound(name), 404);

      // サービス認証: 秘密が無い・合わないなら、関数が在ることも教えない（Convex の http.ts と同じ 404）
      const service = typeof def.auth === "object" ? def.auth : null;
      if (service && !verifyServiceSecret(c.req.raw, service.service, deps.secret(service.service)))
        return c.json(notFound(name), 404);

      const wantsUser = def.auth === "user" || def.auth === "optional" || service?.withUser;
      const identity = wantsUser ? await deps.identify(c.req.raw) : null;
      if (!identity && (def.auth === "user" || service?.withUser))
        return c.json({ code: "unauthenticated", details: {} }, 401);

      // 空の body は引数なし（`{}`）として扱う。壊れた JSON は引数の不正として 400
      const text = await c.req.text();
      let body: unknown;
      try {
        body = text === "" ? {} : JSON.parse(text);
      } catch {
        body = null;
      }
      const parsed = def.args.safeParse(body);
      if (!parsed.success)
        return c.json(
          {
            code: "invalid_args",
            details: {
              issues: parsed.error.issues.map(({ path, message, code }) => ({
                path,
                message,
                code,
              })),
            },
          },
          400,
        );

      const result = await deps.db().call(name, identity, parsed.data, service !== null);
      if (!result.ok)
        return c.json({ code: result.code, details: result.details }, statusOf(result.code));
      return c.json(
        result.reads ? { value: result.value, reads: result.reads } : { value: result.value },
      );
    });
  return app;
}

export type AppType = ReturnType<typeof createApp>;
