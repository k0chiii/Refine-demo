import type { ObjectStore } from "../ports.ts";

function hexToBase64(hex: string): string {
  const pairs = hex.match(/.{2}/g) ?? [];
  const bytes = new Uint8Array(pairs.map((h) => parseInt(h, 16)));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Cloudflare R2 実装。sha256 は R2 側で検証され、不一致なら put が失敗する（破損ファイルを保存しない）。 */
export function createR2Store(bucket: R2Bucket): ObjectStore {
  return {
    async put(key, body, opts) {
      const obj = await bucket.put(key, body, {
        httpMetadata: { contentType: opts.contentType },
        sha256: hexToBase64(opts.sha256Hex),
      });
      if (!obj) throw new Error("R2 put returned null");
      return { size: obj.size, sha256Hex: opts.sha256Hex };
    },
    async head(key) {
      const obj = await bucket.head(key);
      return obj ? { size: obj.size, sha256Hex: null } : null;
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      return { body: obj.body, size: obj.size, contentType: obj.httpMetadata?.contentType ?? null };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}
