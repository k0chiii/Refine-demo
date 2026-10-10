import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth.ts";

const http = httpRouter();
auth.addHttpRoutes(http);

/**
 * サービス間エンドポイント（Hono の R2 清掃 cron 用）。利用者トークンではなく共有秘密で認証する。
 * `MF100_CLEANUP_SECRET` が未設定なら機能ごと無効（404）。本番の秘密はダッシュボード／`convex env set` で設定。
 */
function authorizeService(request: Request): boolean {
  const secret = process.env.MF100_CLEANUP_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

http.route({
  path: "/internal/upload-orphans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!authorizeService(request)) return new Response("Not Found", { status: 404 });
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
    if (!authorizeService(request)) return new Response("Not Found", { status: 404 });
    const body = (await request.json().catch(() => null)) as { itemIds?: unknown } | null;
    const itemIds = Array.isArray(body?.itemIds)
      ? body.itemIds.filter((x): x is string => typeof x === "string")
      : [];
    const purged = await ctx.runMutation(internal.submissions.markObjectsPurged, {
      itemIds: itemIds as never,
    });
    return Response.json({ purged });
  }),
});

export default http;
