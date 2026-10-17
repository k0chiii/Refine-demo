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
  path: "/internal/uploads/items/complete",
  method: "POST",
  handler: serviceUpload(internal.submissions.completeUpload, completeArgs),
});
http.route({
  path: "/internal/uploads/items/fail",
  method: "POST",
  handler: serviceUpload(internal.submissions.failUpload, failArgs),
});
http.route({
  path: "/internal/feedback/files/begin",
  method: "POST",
  handler: serviceUpload(internal.feedback.beginFileUpload, (b) =>
    str(b.fileId) ? { ok: true, args: { fileId: b.fileId } } : { ok: false },
  ),
});
http.route({
  path: "/internal/feedback/files/complete",
  method: "POST",
  handler: serviceUpload(internal.feedback.completeFileUpload, completeArgs),
});
http.route({
  path: "/internal/feedback/files/fail",
  method: "POST",
  handler: serviceUpload(internal.feedback.failFileUpload, failArgs),
});

export default http;
