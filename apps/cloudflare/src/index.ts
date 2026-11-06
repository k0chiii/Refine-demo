import { createApp } from "./app.ts";
import { MF100Database } from "./db.ts";
import { accessIdentifier, devIdentifier, type Identify } from "./identity.ts";

export { MF100Database };

/** JWKS の写しを isolate で使い回す（apps/api と同じ理由: リクエストごとに作ると毎回 certs を取りに行く） */
let identifier: { key: string; identify: Identify } | null = null;
function identifierFor(env: Env): Identify {
  const key = JSON.stringify([env.ACCESS_TEAM, env.ACCESS_AUDIENCE, env.DEV_IDENTITY]);
  if (identifier?.key === key) return identifier.identify;
  const identify =
    env.ACCESS_TEAM && env.ACCESS_AUDIENCE
      ? accessIdentifier(env.ACCESS_TEAM, env.ACCESS_AUDIENCE)
      : env.DEV_IDENTITY === "allow"
        ? devIdentifier
        : async () => null;
  identifier = { key, identify };
  return identify;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const app = createApp({
      identify: identifierFor(env),
      db: () => env.DB.get(env.DB.idFromName("main")),
      secret: (name) => env[name],
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
