import type { ObjectStore } from "../ports.ts";

/** Cloudflare R2 実装。sha256 は R2 側で検証され、不一致なら put が失敗する（破損ファイルを保存しない）。 */
export function createR2Store(bucket: R2Bucket): ObjectStore {
  return {
    async put(key, body, opts) {
      const obj = await bucket.put(key, body, {
        httpMetadata: { contentType: opts.contentType },
        sha256: opts.sha256Hex,
      });
      if (!obj) throw new Error("R2 put returned null");
      return { size: obj.size, sha256Hex: opts.sha256Hex };
    },
    async head(key) {
      const obj = await bucket.head(key);
      return obj ? { size: obj.size, sha256Hex: null, etag: obj.httpEtag } : null;
    },
    async get(key, range) {
      // body は R2 からのストリームのまま返す（Worker のメモリに溜めない）
      const obj = await bucket.get(key, range ? { range } : undefined);
      if (!obj) return null;
      return {
        body: obj.body,
        size: obj.size,
        contentType: obj.httpMetadata?.contentType ?? null,
        etag: obj.httpEtag,
      };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}
