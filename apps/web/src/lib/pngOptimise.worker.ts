/**
 * PNG の可逆な再最適化（oxipng の WASM）を画面と別のスレッドで行う。画面を止めない。
 * 最適化した結果は、元の PNG と画素が 1 つも違わないことを復号して突き合わせてから返す（違えば返さない）。
 * 呼び出し側（pngOptimise.ts）が時間の上限で打ち切る（この Worker ごと終了する）。
 */
import init, { optimise } from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import wasmUrl from "@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url";
import {
  optimisePngBytes,
  type PngWorkerRequest,
  type PngWorkerResponse,
} from "./pngOptimise.core";

let ready: Promise<unknown> | null = null;

// レベル 2（oxipng の既定）・インターレースなし・透明部分の色の書き換えなし（optimizeAlpha=false: 画素の値を変えない）
const codec = { optimise: (data: Uint8Array) => optimise(data, 2, false, false) };

self.onmessage = async (event: MessageEvent<PngWorkerRequest>) => {
  const { id, bytes } = event.data;
  const reply = (r: PngWorkerResponse, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(r, transfer);
  try {
    ready ??= init(wasmUrl);
    await ready;
    const original = new Uint8Array(bytes);
    const outcome = optimisePngBytes(original, codec);
    if (outcome.kind === "kept") return reply({ id, kind: "kept", reason: outcome.reason });
    if (!(await samePixels(original, outcome.bytes)))
      return reply({ id, kind: "kept", reason: "pixels_differ" });
    const out = outcome.bytes.slice().buffer;
    reply({ id, kind: "optimised", bytes: out }, [out]);
  } catch (error) {
    reply({ id, kind: "kept", reason: error instanceof Error ? error.message : "error" });
  }
};

/**
 * 2 つの PNG を同じ復号器（ブラウザ）で復号し、全画素の RGBA が一致するか。色の変換は切って（colorSpaceConversion: none）比べる。
 * 全体を一度にキャンバスへ載せず、帯ごとに比べてメモリを抑える。復号できない環境では false（確かめられない最適化は使わない）
 */
async function samePixels(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function")
    return false;
  const opts = { colorSpaceConversion: "none", premultiplyAlpha: "none" } as const;
  const [bmpA, bmpB] = await Promise.all([
    createImageBitmap(new Blob([a as BlobPart]), opts),
    createImageBitmap(new Blob([b as BlobPart]), opts),
  ]);
  try {
    const { width, height } = bmpA;
    if (bmpB.width !== width || bmpB.height !== height) return false;
    const rows = Math.max(1, Math.floor(4_000_000 / width));
    const canvas = new OffscreenCanvas(width, Math.min(rows, height));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    const band = (bmp: ImageBitmap, y: number, n: number) => {
      ctx.clearRect(0, 0, width, canvas.height);
      ctx.drawImage(bmp, 0, y, width, n, 0, 0, width, n);
      return new Uint32Array(ctx.getImageData(0, 0, width, n).data.buffer);
    };
    for (let y = 0; y < height; y += rows) {
      const n = Math.min(rows, height - y);
      const pa = band(bmpA, y, n);
      const pb = band(bmpB, y, n);
      for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return false;
    }
    return true;
  } finally {
    bmpA.close();
    bmpB.close();
  }
}
