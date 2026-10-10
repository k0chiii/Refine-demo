import type { CleanupGateway } from "../ports.ts";

/** Convex の http.ts `/internal/upload-orphans` を共有秘密で呼ぶ。利用者トークンは使わない。 */
export function createConvexCleanupGateway(siteUrl: string, secret: string): CleanupGateway {
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  const base = siteUrl.replace(/\/$/, "");
  return {
    async listOrphans(limit) {
      const res = await fetch(`${base}/internal/upload-orphans?limit=${limit}`, { headers });
      if (!res.ok) throw new Error(`cleanup list failed: ${res.status}`);
      const body = (await res.json()) as { items: Array<{ itemId: string; objectKey: string }> };
      return body.items;
    },
    async markPurged(itemIds) {
      const res = await fetch(`${base}/internal/upload-orphans/purged`, {
        method: "POST",
        headers,
        body: JSON.stringify({ itemIds }),
      });
      if (!res.ok) throw new Error(`cleanup mark failed: ${res.status}`);
      return ((await res.json()) as { purged: number }).purged;
    },
  };
}
