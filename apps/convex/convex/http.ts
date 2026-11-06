import {
  httpRouter,
  type FunctionArgs,
  type FunctionReference,
  type OptionalRestArgs,
} from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth.ts";
import { bearerValue, verifyServiceSecret } from "./lib/serviceAuth.ts";

const http = httpRouter();
auth.addHttpRoutes(http);

/**
 * サービス間エンドポイント（Hono の R2 清掃 cron 用）。利用者トークンではなく共有秘密で認証する。
 * `MF100_CLEANUP_SECRET` が未設定なら機能ごと無効（404）。本番の秘密はダッシュボード／`convex env set` で設定。
 */
function authorizeCleanup(request: Request): boolean {
  return verifyServiceSecret(
    bearerValue(request.headers.get("authorization")),
    process.env.MF100_CLEANUP_SECRET,
  );
}

http.route({
  path: "/internal/upload-orphans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!authorizeCleanup(request)) return new Response("Not Found", { status: 404 });
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "100");
    const items = await ctx.runMutation(internal.submissions.listOrphanObjects, {
      limit: Number.isFinite(limit) ? limit : 100,
    });
    return Response.json({ items });
  }),
});

http.route({
  path: "/internal/upload-orphans/purged",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorizeCleanup(request)) return new Response("Not Found", { status: 404 });
    const body = (await request.json().catch(() => null)) as { itemIds?: unknown } | null;
    const itemIds = Array.isArray(body?.itemIds)
      ? body.itemIds.filter((x): x is string => typeof x === "string")
      : [];
    const purged = await ctx.runMutation(internal.submissions.markObjectsPurged, {
      itemIds,
    });
    return Response.json({ purged });
  }),
});

/*
 * 実体の転送（Hono 専用）。R2 で実体を検証したサービスだけが、試行の開始・採用・破棄を行える境界。
 * - サービス認証: `X-MF100-Service-Key` に共有秘密 `MF100_UPLOAD_SECRET`（16 文字以上、定数時間比較）。
 *   未設定・不一致なら機能ごと無効（404）。
 * - 利用者: `Authorization: Bearer <利用者の JWT>`（Hono も検証済み）。Convex Auth が再検証し、その主体のまま
 *   internal mutation を呼ぶ。項目の持ち主か・提出できるかは use case が確かめる（サービスでも他人の項目は動かせない）。
 * - 業務エラーは {code, details} を 4xx で返す（mutation は巻き戻っている＝採用されていないと Hono が判断できる）。
 */
const SERVICE_KEY_HEADER = "x-mf100-service-key";

type Parsed<A> = { ok: true; args: A } | { ok: false };

function serviceUpload<F extends FunctionReference<"mutation", "internal">>(
  fn: F,
  parse: (body: Record<string, unknown>) => Parsed<FunctionArgs<F>>,
) {
  return httpAction(async (ctx, request) => {
    if (
      !verifyServiceSecret(request.headers.get(SERVICE_KEY_HEADER), process.env.MF100_UPLOAD_SECRET)
    )
      return new Response("Not Found", { status: 404 });
    if (!(await ctx.auth.getUserIdentity()))
      return Response.json({ code: "unauthenticated", details: {} }, { status: 401 });
    const requestId = request.headers.get("X-Request-ID");
    if (requestId && /^[0-9a-f-]{36}$/.test(requestId))
      console.log(JSON.stringify({ event: "upload_service", requestId }));
    const body = (await request.json().catch(() => null)) as unknown;
    const parsed =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? parse(body as Record<string, unknown>)
        : ({ ok: false } as const);
    if (!parsed.ok) return Response.json({ code: "bad_request", details: {} }, { status: 400 });
    try {
      return Response.json(
        await ctx.runMutation(fn, ...([parsed.args] as unknown as OptionalRestArgs<F>)),
      );
    } catch (error) {
      if (error instanceof ConvexError) {
        const data = error.data as { code?: unknown; details?: unknown };
        const code = typeof data.code === "string" ? data.code : "convex_error";
        return Response.json(
          { code, details: data.details ?? {} },
          { status: code === "unauthenticated" ? 401 : 409 },
        );
      }
      throw error;
    }
  });
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const message = (v: unknown) => (typeof v === "string" ? v.slice(0, 500) : "");

const completeArgs = (b: Record<string, unknown>) =>
  str(b.attemptId) && num(b.size) && typeof b.sha256 === "string" && /^[0-9a-f]{64}$/.test(b.sha256)
    ? ({ ok: true, args: { attemptId: b.attemptId, size: b.size, sha256: b.sha256 } } as const)
    : ({ ok: false } as const);
/** 版の提出物の検証完了: Figma から取り込んだときはノード名などを添える（形が合わなければ無視して保存しない） */
const itemCompleteArgs = (b: Record<string, unknown>) => {
  const parsed = completeArgs(b);
  if (!parsed.ok) return parsed;
  // .ai の PDF 互換の判定（Hono が実体の先頭を見た結果）。boolean 以外は無視する
  const base = {
    ...parsed,
    args: {
      ...parsed.args,
      ...(typeof b.pdfCompatible === "boolean" ? { pdfCompatible: b.pdfCompatible } : {}),
    },
  } as const;
  const f = b.figma;
  if (
    typeof f === "object" &&
    f !== null &&
    str((f as Record<string, unknown>).nodeName) &&
    typeof (f as Record<string, unknown>).box === "object"
  ) {
    const r = f as {
      nodeName: string;
      figmaVersion?: unknown;
      lastModified?: unknown;
      box: Record<string, unknown>;
    };
    const box = {
      width: num(r.box.width) ? r.box.width : 0,
      height: num(r.box.height) ? r.box.height : 0,
    };
    return {
      ok: true,
      args: {
        ...base.args,
        figma: {
          nodeName: r.nodeName.slice(0, 200),
          box,
          ...(str(r.figmaVersion) ? { figmaVersion: r.figmaVersion } : {}),
          ...(str(r.lastModified) ? { lastModified: r.lastModified } : {}),
        },
      },
    } as const;
  }
  return base;
};
const failArgs = (b: Record<string, unknown>) =>
  str(b.attemptId)
    ? ({ ok: true, args: { attemptId: b.attemptId, message: message(b.message) } } as const)
    : ({ ok: false } as const);

http.route({
  path: "/internal/uploads/items/begin",
  method: "POST",
  handler: serviceUpload(internal.submissions.beginUpload, (b) =>
    str(b.itemId) ? { ok: true, args: { itemId: b.itemId } } : { ok: false },
  ),
});
http.route({
  path: "/internal/uploads/items/resume",
  method: "POST",
  handler: serviceUpload(internal.submissions.resumeUpload, (b) =>
    str(b.attemptId) ? { ok: true, args: { attemptId: b.attemptId } } : { ok: false },
  ),
});
http.route({
  path: "/internal/uploads/items/complete",
  method: "POST",
  handler: serviceUpload(internal.submissions.completeUpload, itemCompleteArgs),
});
http.route({
  path: "/internal/uploads/items/fail",
  method: "POST",
  handler: serviceUpload(internal.submissions.failUpload, failArgs),
});

http.route({
  path: "/internal/comments/files/begin",
  method: "POST",
  handler: serviceUpload(internal.commentFiles.beginFileUpload, (b) =>
    str(b.fileId) ? { ok: true, args: { fileId: b.fileId } } : { ok: false },
  ),
});
http.route({
  path: "/internal/comments/files/complete",
  method: "POST",
  handler: serviceUpload(internal.commentFiles.completeFileUpload, completeArgs),
});
http.route({
  path: "/internal/comments/files/fail",
  method: "POST",
  handler: serviceUpload(internal.commentFiles.failFileUpload, failArgs),
});
/** サムネイル（PUT /comment-files/:fileId/thumb）。試行は作らず、固定の置き場に置く */
http.route({
  path: "/internal/comments/thumbs/begin",
  method: "POST",
  handler: serviceUpload(internal.commentFiles.beginThumbUpload, (b) =>
    str(b.fileId) ? { ok: true, args: { fileId: b.fileId } } : { ok: false },
  ),
});
http.route({
  path: "/internal/comments/thumbs/complete",
  method: "POST",
  handler: serviceUpload(internal.commentFiles.completeThumbUpload, (b) =>
    str(b.fileId) && num(b.size) && str(b.mimeType)
      ? { ok: true, args: { fileId: b.fileId, size: b.size, mimeType: b.mimeType } }
      : { ok: false },
  ),
});

/**
 * リンクのプレビュー（OGP）用の公開の応答: 機密区分が通常の制作物の題名だけを返す（works.ogSummary）。
 * Pages の `_worker.js`（apps/web/pages/_worker.template.js）が `/works/:id` の HTML を返す前にここを引き、`og:title` に入れる。
 * 認証なし（Slack などの取得はサインインしていない）。ほかの項目は返さない。5 分の共有キャッシュ可
 */
http.route({
  path: "/og/work",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    const found =
      id.length <= 64 ? await ctx.runQuery(internal.works.ogSummary, { workId: id }) : null;
    if (!found)
      return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json(found, {
      headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
    });
  }),
});

export default http;

/** Queue/Workflow workers carry a job reference, never an expiring application JWT. */
http.route({
  path: "/internal/processing",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.PROCESSING_SECRET;
    if (
      !secret ||
      secret.length < 32 ||
      !verifyServiceSecret(bearerValue(request.headers.get("authorization")), secret)
    )
      return new Response(null, { status: 404 });
    const body = (await request.json()) as { operation?: string; args?: unknown };
    try {
      let result: unknown;
      switch (body.operation) {
        case "cleanupCandidates":
          result = await ctx.runQuery(internal.processing.cleanupCandidates, {});
          break;
        case "markCleaned":
          result = await ctx.runMutation(
            internal.processing.markCleaned,
            body.args as FunctionArgs<typeof internal.processing.markCleaned>,
          );
          break;
        case "inspect":
          result = await ctx.runQuery(
            internal.processing.inspect,
            body.args as FunctionArgs<typeof internal.processing.inspect>,
          );
          break;
        case "complete":
          result = await ctx.runMutation(
            internal.processing.complete,
            body.args as FunctionArgs<typeof internal.processing.complete>,
          );
          break;
        case "fail":
          result = await ctx.runMutation(
            internal.processing.fail,
            body.args as FunctionArgs<typeof internal.processing.fail>,
          );
          break;
        case "figmaComplete":
          result = await ctx.runMutation(
            internal.processing.figmaComplete,
            body.args as FunctionArgs<typeof internal.processing.figmaComplete>,
          );
          break;
        case "streamSession":
          result = await ctx.runMutation(
            internal.processing.streamSession,
            body.args as FunctionArgs<typeof internal.processing.streamSession>,
          );
          break;
        default:
          return new Response(null, { status: 400 });
      }
      return Response.json(result ?? null, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ code: "processing_rejected" }, { status: 409 });
    }
  }),
});
