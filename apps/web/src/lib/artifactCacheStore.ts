import type { ArtifactPersistence } from "./artifactFiles";
import { defaultFileCachePolicy, type FileCachePolicy } from "./fileCachePolicy";

/**
 * 添付ファイルの端末の写し（Cache Storage）。docs/UI_M3E.md §77
 * - 利用者ごとに別の Cache（名前に利用者を含む）。サインアウト・別の利用者のサインインで `clear` が消す
 * - 添付は ID ごとに中身が変わらないので、キーは添付 ID だけ。検証子（ETag）を添えて残し、開くたびに Worker へ
 *   条件付きで「今も見られるか」を確かめる（lib/artifactFiles の revalidate）
 * - 上限（合計・1 ファイル）と期間は FileCachePolicy。超えたら古い順に消す
 * - Cache Storage が使えない・容量が足りない環境では何もしない（写しが無いだけ）
 */
const PREFIX = "mf100-files:";
const INDEX_URL = "/__mf100-files/index";
const entryUrl = (id: string) => `/__mf100-files/${encodeURIComponent(id)}`;

interface Index {
  [artifactId: string]: { size: number; at: number };
}

const cacheName = (subject: string) => `${PREFIX}${encodeURIComponent(subject)}`;

async function readIndex(cache: Cache): Promise<Index> {
  try {
    const res = await cache.match(INDEX_URL);
    return res ? ((await res.json()) as Index) : {};
  } catch {
    return {};
  }
}

async function writeIndex(cache: Cache, index: Index) {
  await cache.put(
    INDEX_URL,
    new Response(JSON.stringify(index), { headers: { "Content-Type": "application/json" } }),
  );
}

export function createCacheStorePersistence(
  policy: FileCachePolicy = defaultFileCachePolicy,
): ArtifactPersistence | null {
  if (typeof caches === "undefined") return null;
  return {
    async get(subject, id) {
      const cache = await caches.open(cacheName(subject));
      const res = await cache.match(entryUrl(id));
      if (!res) return null;
      const index = await readIndex(cache);
      const meta = index[id];
      // 期間を過ぎた写しは使わずに消す（索引に無いものも、残っていても使わない）
      if (!meta || Date.now() - meta.at > policy.ttlMs) {
        await cache.delete(entryUrl(id));
        if (meta) {
          delete index[id];
          await writeIndex(cache, index);
        }
        return null;
      }
      return { blob: await res.blob(), etag: res.headers.get("X-MF100-Etag") };
    },
    async put(subject, id, blob, etag) {
      const cache = await caches.open(cacheName(subject));
      await cache.put(
        entryUrl(id),
        new Response(blob, {
          headers: {
            "Content-Type": blob.type || "application/octet-stream",
            "Content-Length": String(blob.size),
            ...(etag ? { "X-MF100-Etag": etag } : {}),
          },
        }),
      );
      const index = await readIndex(cache);
      index[id] = { size: blob.size, at: Date.now() };
      // 合計の上限: 古い順に消す（いま入れたものは残す）
      let total = Object.values(index).reduce((n, e) => n + e.size, 0);
      for (const [oldId, e] of Object.entries(index).sort((a, b) => a[1].at - b[1].at)) {
        if (total <= policy.maxBytes) break;
        if (oldId === id) continue;
        total -= e.size;
        delete index[oldId];
        await cache.delete(entryUrl(oldId));
      }
      await writeIndex(cache, index);
    },
    async delete(subject, id) {
      const cache = await caches.open(cacheName(subject));
      await cache.delete(entryUrl(id));
      const index = await readIndex(cache);
      if (id in index) {
        delete index[id];
        await writeIndex(cache, index);
      }
    },
    async clear(keepSubject) {
      const keep = keepSubject === undefined ? null : cacheName(keepSubject);
      for (const name of await caches.keys())
        if (name.startsWith(PREFIX) && name !== keep) await caches.delete(name);
    },
  };
}
