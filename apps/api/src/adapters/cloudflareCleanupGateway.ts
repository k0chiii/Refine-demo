import type { CleanupGateway } from "../ports.ts";
import { callFunction } from "./cloudflareGateway.ts";

/**
 * apps/cloudflare の `submissions:listOrphanObjects` / `submissions:markObjectsPurged` を MF100_CLEANUP_SECRET の Bearer で呼ぶ。
 * 利用者トークンは使わない。コメントの添付・採用されなかった試行は Convex 版と同じく itemId の接頭辞（"comment:" / "attempt:"）で 1 本に束ねる前提
 */
export function createCloudflareCleanupGateway(siteUrl: string, secret: string): CleanupGateway {
  const headers = { Authorization: `Bearer ${secret}` };
  return {
    listOrphans: (limit) =>
      callFunction<Array<{ itemId: string; objectKey: string; extraObjectKeys?: string[] }>>(
        siteUrl,
        "submissions:listOrphanObjects",
        headers,
        { limit },
      ),
    markPurged: (itemIds) =>
      callFunction<number>(siteUrl, "submissions:markObjectsPurged", headers, { itemIds }),
  };
}
