import type { Sha256Sink } from "../ports.ts";

type DigestStreamCtor = new (algorithm: string) => WritableStream<Uint8Array> & {
  digest: Promise<ArrayBuffer>;
};

/**
 * Workers の crypto.DigestStream で、流れてくるバイトをそのまま SHA-256 にする（全体をメモリに載せない）。
 * crypto.subtle.digest は全体を一度に渡す必要があり、100 MB 級の実体では使えない。
 */
export function workersSha256Sink(): Sha256Sink {
  const DigestStream = (crypto as unknown as { DigestStream?: DigestStreamCtor }).DigestStream;
  if (!DigestStream) throw new Error("crypto.DigestStream is not available");
  const stream = new DigestStream("SHA-256");
  return {
    writable: stream,
    async digest() {
      const bytes = new Uint8Array(await stream.digest);
      return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
}
