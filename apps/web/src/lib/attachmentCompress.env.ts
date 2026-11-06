import type { ImageEnv, ImageSource, Surface } from "./attachmentCompress.engine";

/**
 * 画像の変換の環境（ブラウザの API）。engine は環境を知らないので、ここで実物に結び付ける。
 * - offscreen: OffscreenCanvas（Worker の中で使う。画面を止めない）
 * - dom: HTMLCanvasElement（Worker か OffscreenCanvas が無い環境での代替。メインスレッドで動く）
 */

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(kind: "offscreen" | "dom", width: number, height: number): AnyCanvas {
  if (kind === "offscreen") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toBlob(canvas: AnyCanvas, type: string, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

function paint(
  canvas: AnyCanvas,
  from: CanvasImageSource,
  width: number,
  height: number,
): AnyCanvas {
  const ctx = canvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("canvas 2d unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(from, 0, 0, width, height);
  return canvas;
}

export function createCanvasEnv(kind: "offscreen" | "dom"): ImageEnv {
  const probes = new Map<string, Promise<boolean>>();

  const surfaceOf = (canvas: AnyCanvas): Surface => ({
    width: canvas.width,
    height: canvas.height,
    async encode(type, quality) {
      const blob = await toBlob(canvas, type, quality);
      // 作れない形式は PNG などに替わって返る。別の形式は採らない
      return blob && blob.type === type ? blob : null;
    },
    resize(width, height) {
      return surfaceOf(paint(makeCanvas(kind, width, height), canvas, width, height));
    },
    close() {
      // メモリをすぐ手放す（Safari はキャンバスの確保が上限に達しやすい）
      canvas.width = 0;
      canvas.height = 0;
    },
  });

  return {
    async decode(blob) {
      let bitmap: ImageBitmap;
      try {
        // 向きは EXIF に従って反映する（スマホの縦撮りが横倒しにならない）
        bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      } catch {
        bitmap = await createImageBitmap(blob);
      }
      const source: ImageSource & { bitmap: ImageBitmap } = {
        width: bitmap.width,
        height: bitmap.height,
        bitmap,
        close: () => bitmap.close(),
      };
      return source;
    },
    draw(source, width, height) {
      const bitmap = (source as ImageSource & { bitmap: ImageBitmap }).bitmap;
      return surfaceOf(paint(makeCanvas(kind, width, height), bitmap, width, height));
    },
    canEncode(type) {
      let probe = probes.get(type);
      if (!probe) {
        // OffscreenCanvas は描画の文脈を作ってからでないと書き出せない
        const canvas = makeCanvas(kind, 1, 1);
        canvas.getContext("2d");
        probe = toBlob(canvas, type, 0.8).then((b) => b !== null && b.type === type);
        probes.set(type, probe);
      }
      return probe;
    },
  };
}
