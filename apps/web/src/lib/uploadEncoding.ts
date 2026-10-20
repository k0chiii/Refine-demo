import {
  GZIP_MIN_GAIN,
  MAX_UPLOAD_BYTES,
  PDF_SIGNATURE_WINDOW,
  planUploadOptimisation,
  savedEnough,
  type UploadEncoding,
} from "@mf100/domain";

/**
 * アップロードする本文の用意（版の提出・コメントの添付で共通。デモも同じ）。
 * ダウンロード専用の原本（.psd・.indd・PDF 互換でない .ai・.eps・.tif など）は gzip して上げる（利用者指示 2026-10-19「劣化ゼロだけ」）。
 * - 申告する sha256・大きさは常に元の実体のもの（アーティファクトの同一性・重複判定は元の実体で決まる）
 * - 圧縮は 256 KB 以上で、10% 以上小さくなったときだけ使う。PDF（PDF 互換の .ai を含む）・動画・JPEG などは触らない（planUploadOptimisation）
 */
export interface EncodedUpload {
  /** 送る本文（gzip のときは圧縮後） */
  body: Blob;
  encoding: UploadEncoding;
  /** 元の実体の大きさと sha256（16 進） */
  originalSize: number;
  sha256: string;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 転送の前の段階。compressing の間、画面は「圧縮しています」を出す（null で終わり） */
export type UploadPhase = "compressing" | null;

export interface EncodeHooks {
  /** 圧縮を始めるとき（「圧縮しています」を出す合図） */
  onCompressing?: () => void;
}

/** gzip の本文が MAX_UPLOAD_BYTES を超えた（圧縮しても Worker の本文の上限に収まらない） */
export class UploadTooLargeError extends Error {
  constructor(readonly size: number) {
    super("upload_file_too_large");
    this.name = "UploadTooLargeError";
  }
}

export async function encodeForUpload(file: File, hooks: EncodeHooks = {}): Promise<EncodedUpload> {
  const buffer = await file.arrayBuffer();
  const sha256 = await sha256Hex(buffer);
  const identity: EncodedUpload = {
    body: file,
    encoding: "identity",
    originalSize: buffer.byteLength,
    sha256,
  };
  const plan = planUploadOptimisation(
    { fileName: file.name, mimeType: file.type, size: buffer.byteLength },
    new Uint8Array(buffer, 0, Math.min(PDF_SIGNATURE_WINDOW, buffer.byteLength)),
  );
  if (plan !== "gzip" || typeof CompressionStream === "undefined") return tooLargeCheck(identity);

  hooks.onCompressing?.();
  try {
    const compressed = await new Response(
      new Blob([buffer]).stream().pipeThrough(new CompressionStream("gzip")),
    ).blob();
    if (savedEnough(buffer.byteLength, compressed.size, GZIP_MIN_GAIN))
      return tooLargeCheck({ ...identity, body: compressed, encoding: "gzip" });
  } catch {
    // 圧縮は付加的なもの。失敗したら元のまま上げる
  }
  return tooLargeCheck(identity);
}

/** 上げる本文が上限を超えるなら、送る前に理由つきで断る（Worker の 413 を待たない） */
function tooLargeCheck(upload: EncodedUpload): EncodedUpload {
  if (upload.body.size > MAX_UPLOAD_BYTES) throw new UploadTooLargeError(upload.body.size);
  return upload;
}

/** アップロードのヘッダー（符号化と元の大きさ。identity は従来どおり sha256 だけ） */
export function encodingHeaders(upload: EncodedUpload): Record<string, string> {
  return {
    "X-MF100-Sha256": upload.sha256,
    ...(upload.encoding === "gzip"
      ? { "X-MF100-Encoding": "gzip", "X-MF100-Original-Size": String(upload.originalSize) }
      : {}),
  };
}

/**
 * gzip の本文を元の実体に伸長する（デモの擬似 Worker の配信・検証と、テストで使う）。
 * maxBytes を超えて伸びたら打ち切って例外にする（伸長爆弾）
 */
export async function gunzipBlob(body: Blob, type = "", maxBytes = Infinity): Promise<Blob> {
  let size = 0;
  const limit = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes) controller.error(new Error("decompressed size exceeds the limit"));
      else controller.enqueue(chunk);
    },
  });
  const stream = body.stream().pipeThrough(new DecompressionStream("gzip")).pipeThrough(limit);
  const out = await new Response(stream).blob();
  return type ? out.slice(0, out.size, type) : out;
}
