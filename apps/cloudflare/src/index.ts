import { createApp } from "./app.ts";
import { MF100Database } from "./db.ts";
import { devIdentifier, type Identify } from "./identity.ts";
import { jwtIdentifier } from "./auth/identify.ts";
import type { AuthStore } from "./auth/store.ts";

export { MF100Database };

/** 本人の特定を isolate で使い回す（env が同じあいだ。リクエストごとに JWT の検証の準備を作り直さない） */
let identifier: { key: string; identify: Identify } | null = null;
function identifierFor(env: Env): Identify {
  const key = JSON.stringify([env.DEV_IDENTITY, env.AUTH_PRIVATE_KEY_JWK, env.SITE_URL]);
  if (identifier?.key === key) return identifier.identify;
  // 本物の順: Worker の JWT（サインイン済み）→ 手元のヘッダ
  const jwt = env.AUTH_PRIVATE_KEY_JWK ? jwtIdentifier(env) : null;
  const fallback: Identify =
    (env.DEV_IDENTITY as string) === "allow" ? devIdentifier : async () => null;
  const identify: Identify = async (request) =>
    (jwt ? await jwt(request) : null) ?? (await fallback(request));
  identifier = { key, identify };
  return identify;
}

/** Durable Object の auth(op, ...args) を AuthStore の形に戻す */
function authStoreOf(stub: DurableObjectStub<MF100Database>): AuthStore {
  return new Proxy({} as AuthStore, {
    get:
      (_target, op: keyof AuthStore) =>
      (...args: unknown[]) =>
        (stub.auth as (op: string, ...a: unknown[]) => Promise<unknown>)(op, ...args),
  });
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const app = createApp({
      identify: identifierFor(env),
      db: () => env.DB.get(env.DB.idFromName("main")),
      secret: (name) => env[name],
      auth: { store: () => authStoreOf(env.DB.get(env.DB.idFromName("main"))), env },
      allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    return app.fetch(request, env, ctx);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      env.DB.get(env.DB.idFromName("main")).runJobs(new Date(controller.scheduledTime)),
    );
  },
} satisfies ExportedHandler<Env>;
