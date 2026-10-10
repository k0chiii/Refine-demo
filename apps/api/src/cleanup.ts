import type { CleanupGateway, ObjectStore } from "./ports.ts";

export interface CleanupResult {
  listed: number;
  purged: number;
  failed: Array<{ itemId: string; message: string }>;
}

/**
 * 放置アップロードセッションの孤立 R2 オブジェクトを削除する（D14）。
 * - 何を消してよいかは Convex（abandoned セッションのみ）が決め、Hono は列挙されたキーだけを消す。
 * - 削除に成功したものだけを記録する。失敗分は次回の走査で再試行される（冪等）。
 */
export async function purgeOrphanObjects(
  deps: { gateway: CleanupGateway; store: ObjectStore },
  limit = 100,
): Promise<CleanupResult> {
  const orphans = await deps.gateway.listOrphans(limit);
  const done: string[] = [];
  const failed: CleanupResult["failed"] = [];
  for (const o of orphans) {
    try {
      await deps.store.delete(o.objectKey);
      done.push(o.itemId);
    } catch (e) {
      failed.push({ itemId: o.itemId, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const purged = done.length > 0 ? await deps.gateway.markPurged(done) : 0;
  return { listed: orphans.length, purged, failed };
}
