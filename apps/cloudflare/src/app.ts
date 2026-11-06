import { DomainError } from "@mf100/domain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ServiceSecret } from "./functions/define.ts";
import { findFunction } from "./functions/index.ts";
import { PROCESSING_OPERATIONS } from "./functions/processing.ts";
import type { Identify, Identity } from "./identity.ts";
import { statusOf, type CallResult } from "./run.ts";
import { verifyServiceSecret } from "./serviceAuth.ts";
import { authApp, type AuthDeps } from "./auth/app.ts";
import type { ImportChunkOptions, ImportChunkResult, ImportRow } from "./migrate/import.ts";
import { importApp } from "./migrate/route.ts";

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
    /** データ移行の取り込み（src/migrate。POST /internal/import だけが使う） */
    importRows(rows: ImportRow[], options: ImportChunkOptions): Promise<ImportChunkResult>;
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
 * - POST /internal/processing  apps/api の Queue / Workflow が処理の台帳を更新する（契約は Convex の http.ts と同じ。下の route）
 * - POST /internal/import  Convex の export を取り込む（移行の間だけ。src/migrate/route.ts）
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
    // ponytail: 取り込みが済んだら、この 1 行を外す（本番に残さない。docs/CLOUDFLARE_BACKEND.md の切り替え）
    .route("/", importApp({ store: () => deps.db(), secret: (n) => deps.secret(n) }))
    .get("/health", (c) => c.json({ ok: true }))
    .get("/ws", async (c) => {
      if (c.req.header("Upgrade") !== "websocket") return c.text("Expected WebSocket", 426);
      // ブラウザの WebSocket はヘッダを付けられない。?token= を Authorization: Bearer と同じに扱う（URL にはログに残るので、渡す前に外す）
      const url = new URL(c.req.url);
      const token = url.searchParams.get("token");
      let request = c.req.raw;
      if (token) {
        url.searchParams.delete("token");
        request = new Request(url, request);
        request.headers.set("Authorization", `Bearer ${token}`);
      }
      if (!(await deps.identify(request))) return c.text("Unauthorized", 401);
      return deps.db().fetch(request);
    })
    // Convex の http.ts の /internal/processing と同じ契約: Bearer PROCESSING_SECRET（32 文字以上。無ければ 404）、
    // body は { operation, args }、成功は関数の戻りの JSON そのもの（{ value } で包まない）、知らない operation は 400、
    // 関数が拒否したら理由を伏せて 409 { code: "processing_rejected" }（apps/api は 409 だけを「拒否」として読み、5xx は再試行する）
    .post("/internal/processing", async (c) => {
      if (!verifyServiceSecret(c.req.raw, "PROCESSING_SECRET", deps.secret("PROCESSING_SECRET")))
        return c.body(null, 404);
      let body: { operation?: unknown; args?: unknown } | null;
      try {
        body = await c.req.json();
      } catch {
        return c.body(null, 400);
      }
      const operation = PROCESSING_OPERATIONS.find((o) => o === body?.operation);
      if (!operation) return c.body(null, 400);
      const name = `processing:${operation}`;
      const rejected = () => c.json({ code: "processing_rejected" }, 409);
      const parsed = findFunction(name)!.args.safeParse(body?.args ?? {});
      if (!parsed.success) return rejected();
      try {
        const result = await deps.db().call(name, null, parsed.data, true);
        return result.ok ? c.json(result.value, 200, { "Cache-Control": "no-store" }) : rejected();
      } catch (e) {
        // 409 は「確定した拒否」で、apps/api は再試行しない。想定外の例外（DB の一時的な失敗など）まで 409 にすると、
        // 直るはずの処理が捨てられるので、5xx（再試行される）で返す
        if (e instanceof DomainError) return rejected();
        console.error("/internal/processing failed", e);
        return c.json({ code: "internal_error" }, 500);
      }
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
