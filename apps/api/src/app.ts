import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type {
  ArtifactAccess,
  BackendGateway,
  ObjectStore,
  TokenVerifier,
  UploadTarget,
} from "./ports.ts";
import { GatewayError } from "./ports.ts";

export interface AppDeps {
  verifier: TokenVerifier;
  gateway: BackendGateway;
  store: ObjectStore;
  allowedOrigins: string[];
}

type AppEnv = { Variables: { token: string; subject: string } };

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * MF100 HTTP 境界（§8.1）。
 * - PUT /uploads/items/:itemId   ブラウザ → R2 直接転送に相当（Worker 経由ストリーミング）。R2 側で sha256 を検証。
 * - GET  /files/:artifactId       認可付き配信。署名付き URL を発行しない（権限剥奪が即時に効く: A-11）。
 * - PUT / GET /feedback/files/:fileId  フィードバック（表現の議論）の添付。上の 2 つと同じ検証・同じヘッダー。
 * 業務ルール（版の確定・受付終了・校了）はここに置かない。
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: (origin) => (deps.allowedOrigins.includes(origin) ? origin : null),
      allowHeaders: ["Authorization", "Content-Type", "X-MF100-Sha256"],
      allowMethods: ["GET", "PUT", "OPTIONS"],
      maxAge: 600,
    }),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  // 認証: Bearer JWT（Convex Auth 発行）。Hono 側でも検証してから Convex に転送する。
  app.use("/uploads/*", requireAuth(deps));
  app.use("/files/*", requireAuth(deps));
  app.use("/feedback/*", requireAuth(deps));

  /**
   * R2 へ保存し、sha256（R2 側で検証）と申告サイズを確かめてから Convex に記録する。
   * 版の提出物とフィードバックの添付で同じ手順を使う（呼ぶ Convex 関数だけが違う）。
   */
  const receiveUpload = async (
    c: Context<AppEnv>,
    id: string,
    idKey: "itemId" | "fileId",
    ops: {
      target(token: string, id: string): Promise<UploadTarget>;
      verified(
        token: string,
        id: string,
        meta: { size: number; sha256: string },
      ): Promise<{ status: string; failureMessage: string | null }>;
      failed(token: string, id: string, message: string): Promise<void>;
    },
  ) => {
    const token = c.get("token");
    const sha256Hex = (c.req.header("X-MF100-Sha256") ?? "").toLowerCase();
    if (!SHA256_HEX.test(sha256Hex))
      return c.json(
        { code: "sha256_required", message: "X-MF100-Sha256 ヘッダー（16進 64 文字）が必要です" },
        400,
      );
    if (!c.req.raw.body) return c.json({ code: "body_required" }, 400);

    const target = await ops.target(token, id);
    try {
      const meta = await deps.store.put(target.objectKey, c.req.raw.body, {
        contentType: target.mimeType,
        sha256Hex,
      });
      if (target.declaredSize !== null && target.declaredSize !== meta.size) {
        await deps.store.delete(target.objectKey);
        const message = `サイズ不一致: 申告 ${target.declaredSize} / 実体 ${meta.size}`;
        await ops.failed(token, id, message);
        return c.json({ code: "size_mismatch", message }, 400);
      }
      const result = await ops.verified(token, id, { size: meta.size, sha256: sha256Hex });
      return c.json({ [idKey]: id, ...result, size: meta.size, sha256: sha256Hex });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      const message = error instanceof Error ? error.message : "アップロードに失敗しました";
      await deps.store.delete(target.objectKey).catch(() => undefined);
      await ops.failed(token, id, message).catch(() => undefined);
      return c.json({ code: "upload_failed", message }, 400);
    }
  };

  /** 認可済みのオブジェクトを配信する。キャッシュさせず、型の推測もさせない */
  const serve = async (access: ArtifactAccess) => {
    const object = await deps.store.get(access.objectKey);
    if (!object) return null;
    return new Response(object.body, {
      headers: {
        "Content-Type": access.mimeType || object.contentType || "application/octet-stream",
        "Content-Length": String(object.size),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(access.fileName)}`,
        // 権限剥奪後にキャッシュから読めないように私的・保存禁止（§9.1）
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };

  app.put("/uploads/items/:itemId", (c) =>
    receiveUpload(c, c.req.param("itemId"), "itemId", {
      target: (t, id) => deps.gateway.itemForUpload(t, id),
      verified: (t, id, meta) => deps.gateway.markVerified(t, id, meta),
      failed: (t, id, message) => deps.gateway.markFailed(t, id, message),
    }),
  );

  app.get("/files/:artifactId", async (c) => {
    const access = await deps.gateway.authorizeArtifact(c.get("token"), c.req.param("artifactId"));
    return (await serve(access)) ?? c.json({ code: "object_missing" }, 404);
  });

  app.put("/feedback/files/:fileId", (c) =>
    receiveUpload(c, c.req.param("fileId"), "fileId", {
      target: (t, id) => deps.gateway.feedbackFileForUpload(t, id),
      verified: (t, id, meta) => deps.gateway.markFeedbackFileVerified(t, id, meta),
      failed: (t, id, message) => deps.gateway.markFeedbackFileFailed(t, id, message),
    }),
  );

  app.get("/feedback/files/:fileId", async (c) => {
    const access = await deps.gateway.authorizeFeedbackFile(c.get("token"), c.req.param("fileId"));
    return (await serve(access)) ?? c.json({ code: "object_missing" }, 404);
  });

  app.onError((error, c) => {
    if (error instanceof GatewayError) {
      const status =
        error.code === "unauthenticated"
          ? 401
          : error.code === "forbidden" || error.code.startsWith("acl_")
            ? 403
            : error.code.endsWith("not_found")
              ? 404
              : 409;
      return c.json({ code: error.code, details: error.details }, status);
    }
    console.error("unhandled", error);
    return c.json({ code: "internal_error" }, 500);
  });

  return app;
}

function requireAuth(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "");
    if (!match) return c.json({ code: "unauthenticated" }, 401);
    const token = match[1]!;
    const verified = await deps.verifier.verify(token);
    if (!verified) return c.json({ code: "unauthenticated" }, 401);
    c.set("token", token);
    c.set("subject", verified.subject);
    await next();
  });
}
