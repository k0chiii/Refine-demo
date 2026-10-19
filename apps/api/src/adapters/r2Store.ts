import type { ObjectStore } from "../ports.ts";

/** gzip で保存した実体の印（customMetadata）。値は固定の "gzip" と、元の大きさ（10 進） */
const ENCODING_KEY = "mf100-encoding";
const ORIGINAL_SIZE_KEY = "mf100-original-size";

function encodingOf(obj: R2Object) {
  const meta = obj.customMetadata;
  if (meta?.[ENCODING_KEY] !== "gzip") return { encoding: null, originalSize: null };
  const size = Number(meta[ORIGINAL_SIZE_KEY]);
  return { encoding: "gzip" as const, originalSize: Number.isFinite(size) ? size : null };
}

/** Cloudflare R2 実装。sha256 は R2 側で検証され、不一致なら put が失敗する（破損ファイルを保存しない）。 */
export function createR2Store(bucket: R2Bucket): ObjectStore {
  return {
    async put(key, body, opts) {
      const gzip = opts.encoding === "gzip";
      const obj = await bucket.put(key, body, {
        httpMetadata: {
          contentType: opts.contentType,
          // 保存した本文の符号化（R2 を直接読む道具にも正しく見える）。配信は customMetadata を見て自分で伸長する
          ...(gzip ? { contentEncoding: "gzip" } : {}),
        },
        ...(gzip
          ? {
              customMetadata: {
                [ENCODING_KEY]: "gzip",
                [ORIGINAL_SIZE_KEY]: String(opts.originalSize ?? ""),
              },
            }
          : {}),
        ...(opts.sha256Hex ? { sha256: opts.sha256Hex } : {}),
      });
      if (!obj) throw new Error("R2 put returned null");
      return { size: obj.size, sha256Hex: opts.sha256Hex ?? null };
    },
    async head(key) {
      const obj = await bucket.head(key);
      return obj
        ? { size: obj.size, sha256Hex: null, etag: obj.httpEtag, ...encodingOf(obj) }
        : null;
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
        ...encodingOf(obj),
      };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}
