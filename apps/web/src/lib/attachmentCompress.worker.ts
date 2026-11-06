/**
 * コメントの添付の画像の変換（復号・縮小・WebP/AVIF への書き出し・サムネイル）を、画面と別のスレッドで行う。
 * 呼び出し側（attachmentCompress.ts）が時間の上限で打ち切る（この Worker ごと終了する）。
 */
import { createCanvasEnv } from "./attachmentCompress.env";
import {
  compressImage,
  type CompressedImage,
  type CompressOptions,
} from "./attachmentCompress.engine";

export interface CompressWorkerRequest {
  id: number;
  blob: Blob;
  options: CompressOptions;
}
export type CompressWorkerResponse =
  | { id: number; ok: true; result: CompressedImage }
  | { id: number; ok: false; message: string };

const env = createCanvasEnv("offscreen");

self.onmessage = async (event: MessageEvent<CompressWorkerRequest>) => {
  const { id, blob, options } = event.data;
  const reply = (r: CompressWorkerResponse) => (self as unknown as Worker).postMessage(r);
  try {
    reply({ id, ok: true, result: await compressImage(blob, env, options) });
  } catch (error) {
    reply({ id, ok: false, message: error instanceof Error ? error.message : "error" });
  }
};
