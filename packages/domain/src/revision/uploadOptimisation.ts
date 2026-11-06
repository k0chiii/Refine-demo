/**
 * アップロード時の可逆圧縮の規則（利用者指示 2026-10-19「アップロード時にファイルを品質を損なわないくらいで圧縮したい」。
 * 範囲の選択は「劣化ゼロだけ」: 中身が 1 ビット・1 画素も変わらない圧縮だけを行い、PDF・JPEG・動画・WebP などはそのまま上げる）。
 * - PNG: 画素が同じまま PNG のまま作り直す（ブラウザの Worker で。速度・上限・得の大きさはここで決める）。
 * - ダウンロード専用の原本（.psd・.indd・PDF 互換でない .ai・.eps・.tif など）: gzip して上げる。保存は圧縮のまま、配信で元に戻す。
 * 入出力を持たない純粋な判定だけ。実際の圧縮はブラウザ（apps/web）、検証と配信は Worker（apps/api）が行う。
 */
import { DomainError } from "../shared/DomainError.ts";
import { MAX_UPLOAD_BYTES } from "./UploadSession.ts";
import { fileExtension, hasPdfSignature, sourceFormatMimeTypes } from "./graphicFiles.ts";

// ---------------------------------------------------------------- 閾値

/** PNG の再最適化: これより大きい PNG は触らない（ブラウザのメモリ・時間に収める） */
export const PNG_OPTIMISE_MAX_BYTES = 40 * 1000 * 1000;
/** これより小さい PNG は得が小さく、起動のほうが高くつくので触らない */
export const PNG_OPTIMISE_MIN_BYTES = 16 * 1024;
/** 画素数の上限（復号して画素を突き合わせるため。これを超える画像は触らない） */
export const PNG_OPTIMISE_MAX_PIXELS = 50_000_000;
/** この割合（5%）以上小さくなったときだけ最適化後を使う */
export const PNG_OPTIMISE_MIN_GAIN = 0.05;
/** 最適化にかける時間の上限。超えたら打ち切って元のファイルを上げる */
export const PNG_OPTIMISE_TIME_BUDGET_MS = 8000;

/** gzip する下限（これ未満は得が小さい） */
export const GZIP_MIN_BYTES = 256 * 1024;
/** この割合（10%）以上小さくなったときだけ gzip を使う */
export const GZIP_MIN_GAIN = 0.1;

/** 申告する元のサイズの上限。上げる本文の上限（MAX_UPLOAD_BYTES）の 4 倍まで。伸長爆弾を防ぐ */
export const MAX_ORIGINAL_UPLOAD_BYTES = 4 * MAX_UPLOAD_BYTES;

// ---------------------------------------------------------------- 符号化の宣言

export type UploadEncoding = "identity" | "gzip";

/** ヘッダーの値を符号化に読み替える。無ければ identity。知らない値は null（受け付けない） */
export function parseUploadEncoding(value: string | null | undefined): UploadEncoding | null {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "" || v === "identity") return "identity";
  if (v === "gzip") return "gzip";
  return null;
}

/** 最適化後が `minGain` 以上小さいか（元と同じ・大きくなったときは false） */
export function savedEnough(originalSize: number, optimisedSize: number, minGain: number): boolean {
  return originalSize > 0 && optimisedSize <= originalSize * (1 - minGain);
}

// ---------------------------------------------------------------- 何を圧縮するか

/** すでに圧縮された形式（gzip しても得がない）の拡張子 */
const COMPRESSED_EXT = new Set([
  "zip", "7z", "rar", "gz", "tgz", "bz2", "xz", "zst", "lz", "lzma", "cab",
  "docx", "xlsx", "pptx", "odt", "ods", "odp", "epub", "jar", "apk", "idml",
  "sketch", "fig", "xd", "afdesign", "afphoto",
  "jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "jxl",
  "mp4", "m4v", "mov", "webm", "mkv", "avi", "mp3", "aac", "m4a", "flac", "ogg", "opus",
  "woff", "woff2", "pdf",
]); // prettier-ignore

/** 紙面・画面に出さず、保管・ダウンロードだけの原本で、圧縮前の形が多い拡張子（MIME が画像でも対象） */
const DOWNLOAD_ONLY_EXT = new Set([
  "psd", "psb", "tif", "tiff", "bmp", "tga", "exr", "hdr", "eps", "ps", "ai", "indd", "indt",
]); // prettier-ignore

/**
 * 中身が圧縮済みの形式の先頭バイト（拡張子が当てにならないときの保険。見つけたら gzip しない）。
 * zip・gzip・7z・rar・bz2・xz・zstd・PNG・JPEG・GIF・WebP・mp4/mov/heic（ftyp）・mp3(ID3)・ogg・flac
 */
export function looksCompressed(head: Uint8Array): boolean {
  const at = (i: number, ...b: number[]) => b.every((v, k) => head[i + k] === v);
  const ascii = (i: number, s: string) =>
    Array.from(s).every((c, k) => head[i + k] === c.charCodeAt(0));
  return (
    at(0, 0x50, 0x4b, 0x03, 0x04) ||
    at(0, 0x1f, 0x8b) ||
    at(0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c) ||
    ascii(0, "Rar!") ||
    ascii(0, "BZh") ||
    at(0, 0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00) ||
    at(0, 0x28, 0xb5, 0x2f, 0xfd) ||
    at(0, 0x89, 0x50, 0x4e, 0x47) ||
    at(0, 0xff, 0xd8, 0xff) ||
    ascii(0, "GIF8") ||
    (ascii(0, "RIFF") && ascii(8, "WEBP")) ||
    ascii(4, "ftyp") ||
    ascii(0, "ID3") ||
    ascii(0, "OggS") ||
    ascii(0, "fLaC")
  );
}

/** 申告された MIME を正す（.ai / .indd はブラウザの MIME が当てにならない。画面の guessMimeType と同じ規則） */
function declaredMime(fileName: string, mimeType: string): string {
  return sourceFormatMimeTypes[fileExtension(fileName)] ?? mimeType.toLowerCase();
}

/**
 * gzip して上げてよい種類か（名前と MIME だけで決まる部分）。Range で読む PDF（PDF 互換の .ai を含む）・動画・音声、
 * ブラウザで描く画像・文章、圧縮済みの形式は対象外。先頭のバイトでの確認は planUploadOptimisation。
 * 準備のときの上限（maxDeclaredBytesFor）と Worker の受け入れ（isGzipAllowed）もこれを使う
 */
export function isGzipCandidate(file: { fileName: string; mimeType: string }): boolean {
  const ext = fileExtension(file.fileName);
  if (COMPRESSED_EXT.has(ext)) return false;
  const mime = declaredMime(file.fileName, file.mimeType);
  if (mime === "application/pdf" || /^(video|audio|text)\//.test(mime)) return false;
  if (DOWNLOAD_ONLY_EXT.has(ext)) return true;
  // 画像はブラウザで描くので対象外（PNG は別に最適化する）。それ以外（application/*・MIME 無し）は原本として対象
  return !mime.startsWith("image/");
}

/**
 * Worker が gzip の上げ方を受け入れてよいか。ブラウザの判定を信じず、Range で読む形（PDF・動画・音声。PDF の見出しを持つ中身を含む）
 * だけを拒む。head は伸長した実体の先頭（PDF_SIGNATURE_WINDOW 分）
 */
export function isGzipAllowed(
  file: { fileName: string; mimeType: string },
  head?: Uint8Array,
): boolean {
  const mime = declaredMime(file.fileName, file.mimeType);
  if (mime === "application/pdf" || /^(video|audio)\//.test(mime)) return false;
  return !head || !hasPdfSignature(head);
}

/** 準備のときに受ける元のサイズの上限。gzip できる種類は本文の 4 倍まで（圧縮後に MAX_UPLOAD_BYTES へ収まるかは送るとき確かめる） */
export function maxDeclaredBytesFor(file: { fileName: string; mimeType: string }): number {
  return isGzipCandidate(file) ? MAX_ORIGINAL_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
}

/** 申告された元のサイズが、その種類の上限内か。超えるときは upload_file_too_large（準備のとき・画面で選んだとき） */
export function assertDeclaredSizeWithinLimit(file: {
  fileName: string;
  mimeType: string;
  size: number | undefined;
}): void {
  const limit = maxDeclaredBytesFor(file);
  if (file.size !== undefined && file.size > limit)
    throw new DomainError("upload_file_too_large", {
      fileName: file.fileName,
      size: file.size,
      limit,
    });
}

export type UploadOptimisation = "png" | "gzip" | "none";

/**
 * このファイルにどの圧縮を試すか。head はファイルの先頭（PDF_SIGNATURE_WINDOW 分あれば足りる）。
 * 試した結果を使うかは別（PNG は acceptPngOptimisation と PNG_OPTIMISE_MIN_GAIN、gzip は GZIP_MIN_GAIN）
 */
export function planUploadOptimisation(
  file: { fileName: string; mimeType: string; size: number },
  head: Uint8Array,
): UploadOptimisation {
  const ext = fileExtension(file.fileName);
  if (
    (ext === "png" || file.mimeType.toLowerCase() === "image/png") &&
    hasPngSignature(head) &&
    file.size >= PNG_OPTIMISE_MIN_BYTES &&
    file.size <= PNG_OPTIMISE_MAX_BYTES
  )
    return "png";
  if (
    isGzipCandidate(file) &&
    file.size >= GZIP_MIN_BYTES &&
    !hasPdfSignature(head) &&
    !looksCompressed(head)
  )
    return "gzip";
  return "none";
}

// ---------------------------------------------------------------- PNG

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function hasPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

export interface PngChunk {
  type: string;
  /** チャンク先頭（長さの欄）の位置 */
  offset: number;
  /** データ部の長さ */
  length: number;
}

const u32 = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;

/** PNG のチャンクを先頭から読む。署名が違う・途中で切れている・IEND が無いときは null（CRC は見ない） */
export function readPngChunks(bytes: Uint8Array): PngChunk[] | null {
  if (!hasPngSignature(bytes)) return null;
  const chunks: PngChunk[] = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const length = u32(bytes, pos);
    const type = String.fromCharCode(
      bytes[pos + 4]!,
      bytes[pos + 5]!,
      bytes[pos + 6]!,
      bytes[pos + 7]!,
    );
    if (pos + 12 + length > bytes.length) return null;
    chunks.push({ type, offset: pos, length });
    pos += 12 + length;
    if (type === "IEND") return chunks[0]?.type === "IHDR" ? chunks : null;
  }
  return null;
}

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  interlace: number;
}

export function readPngHeader(bytes: Uint8Array): PngHeader | null {
  if (!hasPngSignature(bytes) || bytes.length < 33 || u32(bytes, 8) !== 13) return null;
  return {
    width: u32(bytes, 16),
    height: u32(bytes, 20),
    bitDepth: bytes[24]!,
    colourType: bytes[25]!,
    interlace: bytes[28]!,
  };
}

/** 見え方（色・向き・実寸）を決めるチャンク。最適化後も原本と同じ内容で残っていなければ使わない（text・時刻などは問わない） */
export const PNG_RENDERING_CHUNKS = [
  "iCCP",
  "sRGB",
  "gAMA",
  "cHRM",
  "cICP",
  "mDCV",
  "cLLI",
  "pHYs",
  "eXIf",
] as const;

export type PngSkipReason =
  | "not_png"
  | "malformed"
  | "animated"
  | "too_many_pixels"
  | "high_bit_depth";

/**
 * 最適化を試してよい PNG か。アニメーション PNG は画面が失われるので触らない。16 ビット色は、画素の突き合わせ（8 ビットに復号して比べる）で
 * 下位バイトの違いを見分けられないので触らない（確かめられない最適化はしない）
 */
export function checkPngForOptimisation(
  bytes: Uint8Array,
): { ok: true } | { ok: false; reason: PngSkipReason } {
  if (!hasPngSignature(bytes)) return { ok: false, reason: "not_png" };
  const header = readPngHeader(bytes);
  const chunks = readPngChunks(bytes);
  if (!header || !chunks) return { ok: false, reason: "malformed" };
  if (chunks.some((c) => c.type === "acTL")) return { ok: false, reason: "animated" };
  if (header.bitDepth === 16) return { ok: false, reason: "high_bit_depth" };
  if (header.width * header.height > PNG_OPTIMISE_MAX_PIXELS)
    return { ok: false, reason: "too_many_pixels" };
  return { ok: true };
}

const chunkBytes = (bytes: Uint8Array, c: PngChunk) =>
  bytes.subarray(c.offset, c.offset + 12 + c.length);
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * 最適化後の PNG を使ってよいか（構造の確認。画素そのものの突き合わせは復号できる環境で別に行う）。
 * - PNG として最後まで読める・縦横が同じ
 * - 見え方を決めるチャンク（PNG_RENDERING_CHUNKS）が原本にあれば、同じ内容で残っている
 * 色の持ち方（RGB→パレットなど）は画素が同じなら変わってよい。コメント・時刻などの付随情報は問わない
 */
export function acceptPngOptimisation(
  original: Uint8Array,
  optimised: Uint8Array,
): { ok: true } | { ok: false; reason: "malformed" | "dimensions" | "rendering_chunk" } {
  const a = readPngChunks(original);
  const b = readPngChunks(optimised);
  const ha = readPngHeader(original);
  const hb = readPngHeader(optimised);
  if (!a || !b || !ha || !hb) return { ok: false, reason: "malformed" };
  if (ha.width !== hb.width || ha.height !== hb.height) return { ok: false, reason: "dimensions" };
  for (const type of PNG_RENDERING_CHUNKS) {
    const want = a.filter((c) => c.type === type).map((c) => chunkBytes(original, c));
    if (want.length === 0) continue;
    const have = b.filter((c) => c.type === type).map((c) => chunkBytes(optimised, c));
    if (want.length !== have.length || !want.every((w, i) => sameBytes(w, have[i]!)))
      return { ok: false, reason: "rendering_chunk" };
  }
  return { ok: true };
}
