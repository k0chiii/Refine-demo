import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { importFigmaFrames, type FigmaImportItem } from "./figmaImport.ts";
import { matchesIfNoneMatch, resolveRange } from "./httpRange.ts";
import type {
  ArtifactAccess,
  BackendGateway,
  FigmaClient,
  ObjectStore,
  TokenVerifier,
  UploadOps,
} from "./ports.ts";
import { GatewayError } from "./ports.ts";

export interface AppDeps {
  verifier: TokenVerifier;
  gateway: BackendGateway;
  store: ObjectStore;
  allowedOrigins: string[];
  /** Figma REST API（FIGMA_ACCESS_TOKEN があるときだけ。無ければ null で /figma は「未設定」） */
  figma?: FigmaClient | null;
  /** Figma の書き出しの倍率（domain の FigmaPolicy.renderScale。既定 2） */
  figmaScale?: number;
}

type AppEnv = { Variables: { token: string; subject: string } };

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * MF100 HTTP 境界（§8.1）。
 * - PUT /uploads/items/:itemId   ブラウザ → R2 直接転送に相当（Worker 経由ストリーミング）。R2 側で sha256 を検証。
 *   書込み先は試行ごとに Convex が払い出す別キー。検証の済んだ 1 つだけを Convex が原子的に採用する。
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
      // Range / If-None-Match / If-Range: 配信の部分取得（PDF.js の逐次読み込み）と、手元の写しが今も有効かの確認
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "X-MF100-Sha256",
        "Range",
        "If-None-Match",
        "If-Range",
      ],
      allowMethods: ["GET", "HEAD", "PUT", "POST", "OPTIONS"],
      // ブラウザの JS から読めるようにする応答ヘッダー（範囲の取得に Content-Range・Accept-Ranges が要る）
      exposeHeaders: ["Content-Range", "Accept-Ranges", "Content-Length", "ETag"],
      maxAge: 7200,
    }),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  // 認証: Bearer JWT（Convex Auth 発行）。Hono 側でも検証してから Convex に転送する。
  app.use("/uploads/*", requireAuth(deps));
  app.use("/files/*", requireAuth(deps));
  app.use("/feedback/*", requireAuth(deps));
  app.use("/figma/*", requireAuth(deps));

  /**
   * R2 へ保存し、sha256（R2 側で検証）と申告サイズを確かめてから Convex に採用を求める。
   * 版の提出物とフィードバックの添付で同じ手順を使う（呼ぶ Convex 関数だけが違う）。
   * - 書込み先は試行ごとの別キー。遅れた PUT・負けた PUT が、採用済みの実体を上書きすることはない。
   * - 補償で消すのは自分の試行のキーだけ。それも「採用されていない」と確かなとき（Convex が拒否した等）に限る。
   *   採否が分からない失敗（通信断）では消さない。未採用なら期限後に清掃が消し、採用済みの実体は決して消さない。
   */
  const receiveUpload = async (
    c: Context<AppEnv>,
    id: string,
    idKey: "itemId" | "fileId",
    ops: UploadOps,
  ) => {
    const token = c.get("token");
    const sha256Hex = (c.req.header("X-MF100-Sha256") ?? "").toLowerCase();
    if (!SHA256_HEX.test(sha256Hex))
      return c.json(
        { code: "sha256_required", message: "X-MF100-Sha256 ヘッダー（16進 64 文字）が必要です" },
        400,
      );
    if (!c.req.raw.body) return c.json({ code: "body_required" }, 400);

    const target = await ops.begin(token, id);
    /** 採用されていないことが確かな試行を片付ける（自分のキーを消し、破棄を記録する） */
    const discard = async (message: string) => {
      await deps.store.delete(target.objectKey).catch(() => undefined);
      await ops.fail(token, target.attemptId, message).catch(() => undefined);
    };

    let size: number;
    try {
      const meta = await deps.store.put(target.objectKey, c.req.raw.body, {
        contentType: target.mimeType,
        sha256Hex,
      });
      size = meta.size;
    } catch (error) {
      const message = error instanceof Error ? error.message : "アップロードに失敗しました";
      await discard(message);
      return c.json({ code: "upload_failed", message }, 400);
    }
    if (target.declaredSize !== null && target.declaredSize !== size) {
      const message = `サイズ不一致: 申告 ${target.declaredSize} / 実体 ${size}`;
      await discard(message);
      return c.json({ code: "size_mismatch", message }, 400);
    }

    let result: { status: string; failureMessage: string | null };
    try {
      result = await ops.complete(token, target.attemptId, { size, sha256: sha256Hex });
    } catch (error) {
      // Convex が拒否した（mutation は巻き戻り、この試行は採用されていない）ときだけ自分の実体を消す
      if (error instanceof GatewayError) await discard(error.code);
      throw error;
    }
    // 採用されなかった（申告と違う等。Convex 側で破棄済み）なら自分の実体を消す。消し損ねても清掃が消す
    if (result.status !== "verified")
      await deps.store.delete(target.objectKey).catch(() => undefined);
    return c.json({ [idKey]: id, ...result, size, sha256: sha256Hex });
  };

  /**
   * 認可済みのオブジェクトを配信する。型の推測はさせない。
   * - ブラウザの HTTP キャッシュには残さない（`private, no-store`）。権限剥奪後にキャッシュから読めないため（§9.1 / A-11）。
   *   `max-age` / `immutable` は付けない: 付けるとブラウザが Worker に尋ねずに写しを返し、剥奪が効かなくなる。
   *   手元の写し（クライアントの利用者別キャッシュ）は、毎回認可を通るここへの条件付き取得（ETag）で今も見られるか確かめる。
   * - Range 対応（206 / 416）と強い ETag（If-None-Match → 304）。認可を通ったあとにだけ判定するので、304 でも権限は毎回確かめている。
   * - 本体は R2 のストリームをそのまま渡す（Worker のメモリに溜めない）。範囲のときは R2 の範囲読み。
   *   no-transform: 経路で圧縮・変換させない（Content-Length と範囲の位置が狂わないように）
   */
  const serve = async (access: ArtifactAccess, req: Request) => {
    const rangeHeader = req.headers.get("Range") ?? undefined;
    const ifNoneMatch = req.headers.get("If-None-Match") ?? undefined;
    const ifRange = req.headers.get("If-Range") ?? undefined;

    const headersFor = (etag: string | null, contentType: string | null) => {
      const h: Record<string, string> = {
        "Content-Type": access.mimeType || contentType || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(access.fileName)}`,
        "Cache-Control": "private, no-store, no-transform",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
      };
      if (etag) h.ETag = etag;
      return h;
    };

    // 範囲も条件も無い通常の取得は R2 を 1 回だけ読む
    if (!rangeHeader && !ifNoneMatch) {
      const object = await deps.store.get(access.objectKey);
      if (!object) return null;
      return new Response(object.body, {
        headers: {
          ...headersFor(object.etag, object.contentType),
          "Content-Length": String(object.size),
        },
      });
    }

    const head = await deps.store.head(access.objectKey);
    if (!head) return null;
    if (matchesIfNoneMatch(ifNoneMatch, head.etag))
      return new Response(null, { status: 304, headers: headersFor(head.etag, null) });

    // If-Range が今の実体の検証子と違えば、範囲は無視して全体を返す
    const honorRange = !ifRange || ifRange === head.etag;
    const range = honorRange ? resolveRange(rangeHeader, head.size) : null;
    if (range === "unsatisfiable")
      return new Response(null, {
        status: 416,
        headers: { ...headersFor(head.etag, null), "Content-Range": `bytes */${head.size}` },
      });
    const object = await deps.store.get(access.objectKey, range ?? undefined);
    if (!object) return null;
    if (!range)
      return new Response(object.body, {
        headers: {
          ...headersFor(object.etag, object.contentType),
          "Content-Length": String(object.size),
        },
      });
    return new Response(object.body, {
      status: 206,
      headers: {
        ...headersFor(object.etag, object.contentType),
        "Content-Length": String(range.length),
        "Content-Range": `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
      },
    });
  };

  app.put("/uploads/items/:itemId", (c) =>
    receiveUpload(c, c.req.param("itemId"), "itemId", deps.gateway.itemUploads),
  );

  app.get("/files/:artifactId", async (c) => {
    const access = await deps.gateway.authorizeArtifact(c.get("token"), c.req.param("artifactId"));
    return (await serve(access, c.req.raw)) ?? c.json({ code: "object_missing" }, 404);
  });

  app.put("/feedback/files/:fileId", (c) =>
    receiveUpload(c, c.req.param("fileId"), "fileId", deps.gateway.feedbackUploads),
  );

  app.get("/feedback/files/:fileId", async (c) => {
    const access = await deps.gateway.authorizeFeedbackFile(c.get("token"), c.req.param("fileId"));
    return (await serve(access, c.req.raw)) ?? c.json({ code: "object_missing" }, 404);
  });

  /**
   * Figma 連携（docs/FIGMA_WEB_PROOFING.md FG-05。利用者決定 2026-10-17「API が使えるならまずはそっちで試す」）。
   * - GET /figma/status: トークンが設定されているか（UI が「Figma から取り込む」を出すか決める）
   * - POST /figma/import: 準備済みの項目（由来 figma）に、Figma から書き出した PNG を入れる。
   *   トークンはこの Worker の秘密で、ブラウザへは渡さない。項目の持ち主か・受付中かは Convex が確かめる
   */
  app.get("/figma/status", (c) => c.json({ enabled: Boolean(deps.figma) }));
  app.post("/figma/import", async (c) => {
    if (!deps.figma)
      return c.json(
        {
          code: "figma_not_configured",
          message:
            "Figma 連携が未設定です（FIGMA_ACCESS_TOKEN）。書き出した PNG/PDF を添付してください",
        },
        503,
      );
    const body = (await c.req.json().catch(() => null)) as { items?: unknown } | null;
    const items = Array.isArray(body?.items) ? (body!.items as unknown[]) : null;
    if (!items || items.length === 0 || items.length > 50)
      return c.json({ code: "bad_request", message: "items（1〜50 件）が必要です" }, 400);
    const parsed: FigmaImportItem[] = [];
    for (const raw of items) {
      const it = raw as Record<string, unknown>;
      if (
        typeof it.itemId !== "string" ||
        typeof it.fileKey !== "string" ||
        typeof it.nodeId !== "string" ||
        it.itemId.length > 200
      )
        return c.json({ code: "bad_request", message: "items の形が違います" }, 400);
      parsed.push({ itemId: it.itemId, fileKey: it.fileKey, nodeId: it.nodeId });
    }
    const results = await importFigmaFrames(
      {
        figma: deps.figma,
        uploads: deps.gateway.itemUploads,
        store: deps.store,
        scale: deps.figmaScale ?? 2,
      },
      c.get("token"),
      parsed,
    );
    return c.json({ items: results });
  });

  app.onError((error, c) => {
    if (error instanceof GatewayError) {
      const status =
        error.code === "unauthenticated"
          ? 401
          : error.code === "upload_service_unavailable"
            ? 503
            : error.code === "bad_request"
              ? 400
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
