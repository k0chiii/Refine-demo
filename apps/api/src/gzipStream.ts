import { PDF_SIGNATURE_WINDOW } from "@mf100/domain";
import type { Sha256Sink } from "./ports.ts";

export type GzipVerification =
  | { ok: true; size: number; sha256Hex: string; head: Uint8Array }
  | { ok: false; reason: "corrupt" | "too_large" | "size_mismatch" | "sha_mismatch" };

/**
 * gzip で上げられた実体が、申告された元の実体に伸長されることを、ストリームのまま確かめる（全体をメモリに載せない）。
 * 伸長しながら大きさを数えて SHA-256 を取り、申告と突き合わせる。
 * - 申告の大きさを超えて伸びた時点で打ち切る（伸長爆弾: 小さな本文が際限なく大きくなる攻撃を、申告の上限で止める）
 * - 壊れた gzip（途中で切れた・CRC の不一致）は corrupt
 * 先頭の PDF_SIGNATURE_WINDOW バイトも返す（PDF の見出しを持つ実体を gzip で受けないための確認に使う）
 */
export async function verifyGzipStream(
  source: ReadableStream<Uint8Array>,
  expected: { size: number; sha256Hex: string },
  sink: Sha256Sink,
): Promise<GzipVerification> {
  let size = 0;
  let overflow = false;
  const head = new Uint8Array(Math.min(PDF_SIGNATURE_WINDOW, expected.size));
  const meter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (size + chunk.byteLength > expected.size) {
        overflow = true;
        controller.error(new Error("decompressed size exceeds the declared size"));
        return;
      }
      if (size < head.length) head.set(chunk.subarray(0, head.length - size), size);
      size += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  try {
    await source
      .pipeThrough(
        new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
      )
      .pipeThrough(meter)
      .pipeTo(sink.writable);
  } catch {
    return { ok: false, reason: overflow ? "too_large" : "corrupt" };
  }
  if (size !== expected.size) return { ok: false, reason: "size_mismatch" };
  const sha256Hex = await sink.digest();
  if (sha256Hex !== expected.sha256Hex) return { ok: false, reason: "sha_mismatch" };
  return { ok: true, size, sha256Hex, head: head.subarray(0, Math.min(size, head.length)) };
}

/**
 * gzip で保存した実体を、配信のために元の実体へ伸長するストリームにする。
 * 元の大きさが分かるときは FixedLengthStream（Workers）で通し、Content-Length が本文と食い違わないようにする
 */
export function gunzipStream(
  body: ReadableStream<Uint8Array>,
  originalSize: number | null,
): ReadableStream<Uint8Array> {
  const decoded = body.pipeThrough(
    new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
  const Fixed = (
    globalThis as unknown as {
      FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array>;
    }
  ).FixedLengthStream;
  if (originalSize === null || !Fixed) return decoded;
  return decoded.pipeThrough(new Fixed(originalSize));
}
