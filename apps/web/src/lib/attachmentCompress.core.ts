/**
 * コメント・返信の添付の画像を、送る前に縮めるための純粋な取り決め（利用者決定 2026-10-20「添付はできる限り圧縮して良い」）。
 * ブラウザの API（デコード・キャンバス）には触れない。どの形式で・どの大きさで・どれを採るかだけを決める。
 * 実際の変換は attachmentCompress.engine.ts（環境を差し込む）、画面を止めない実行は attachmentCompress.worker.ts。
 */

/** 長辺の上限（px）。これを超える画像は縦横比を保って縮める */
export const ATTACHMENT_MAX_LONG_SIDE = 2560;
/** 一覧用サムネイルの長辺（px） */
export const ATTACHMENT_THUMB_LONG_SIDE = 480;
/** 本体の WebP / AVIF の品質（0〜1） */
export const ATTACHMENT_QUALITY = 0.8;
/** サムネイルの品質（0〜1） */
export const ATTACHMENT_THUMB_QUALITY = 0.7;
/** 縮める前の大きさが小さい画像は作り直さない（世代劣化と時間のわりに得が無い）。サムネイルは作る */
export const ATTACHMENT_SKIP_RECODE_BELOW_BYTES = 24 * 1024;
/** 作り直した画像を採る最低限の縮み方（元の大きさに対する割合）。これより縮まなければ元のまま */
export const ATTACHMENT_MIN_GAIN = 0.05;
/** WebP の結果がこれ以下なら AVIF は試さない（エンコードが遅いわりに得が小さい） */
export const ATTACHMENT_AVIF_TRY_ABOVE_BYTES = 64 * 1024;
/** 1 枚の変換にかける時間の上限（ms）。超えたら Worker ごと止めて元のまま上げる */
export const ATTACHMENT_COMPRESS_TIME_BUDGET_MS = 20_000;

export type EncodedImageType = "image/webp" | "image/avif";

/** 変換の対象になる画像か（アニメーション GIF と SVG は対象外。HEIC は復号できたときだけ変換する） */
const COMPRESSIBLE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/gif",
  "image/bmp",
]);
const COMPRESSIBLE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "avif",
  "heic",
  "heif",
  "gif",
  "bmp",
]);

const extOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
const baseMime = (mime: string) => mime.toLowerCase().split(";")[0]!.trim();

export function isCompressibleImage(file: { name: string; type: string }): boolean {
  const mime = baseMime(file.type);
  if (mime === "image/svg+xml" || extOf(file.name) === "svg") return false;
  if (mime !== "") return COMPRESSIBLE_MIME.has(mime);
  return COMPRESSIBLE_EXT.has(extOf(file.name));
}

/** 画像の種類を MIME から（クリップボードの貼り付けなど、種類が空のとき拡張子から） */
export function guessImageMime(file: { name: string; type: string }): string {
  const mime = baseMime(file.type);
  if (mime !== "") return mime;
  switch (extOf(file.name)) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

/**
 * アニメーション GIF か。GIF のブロックを辿り、画像（0x2C）が 2 枚以上あれば動く画像とみなす。
 * 壊れた GIF は「動く」扱いにして触らない（元のまま上げる）
 */
export function isAnimatedGif(bytes: Uint8Array): boolean {
  if (bytes.length < 13) return true;
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  if (head !== "GIF87a" && head !== "GIF89a") return true;
  let pos = 13;
  const flags = bytes[10]!;
  if (flags & 0x80) pos += 3 * (1 << ((flags & 0x07) + 1));
  let frames = 0;
  while (pos < bytes.length) {
    const block = bytes[pos++]!;
    if (block === 0x3b) return frames > 1; // trailer
    if (block === 0x21) {
      pos++; // 拡張のラベル
      pos = skipSubBlocks(bytes, pos);
    } else if (block === 0x2c) {
      frames++;
      if (frames > 1) return true;
      if (pos + 9 > bytes.length) return true;
      const local = bytes[pos + 8]!;
      pos += 9;
      if (local & 0x80) pos += 3 * (1 << ((local & 0x07) + 1));
      pos++; // LZW の最小コード長
      pos = skipSubBlocks(bytes, pos);
    } else {
      return true; // 想定外のブロック
    }
  }
  // 末尾（0x3b）に届かず終わった: 途中までしか読んでいない・壊れている。動くものとみなして触らない
  return true;
}

function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let pos = start;
  while (pos < bytes.length) {
    const size = bytes[pos++]!;
    if (size === 0) return pos;
    pos += size;
  }
  return pos;
}

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * 長辺が maxLong を超えるときだけ、縦横比を保って縮める（拡大はしない）。各辺は 1 px 以上の整数
 */
export function fitWithin(size: Dimensions, maxLong: number): Dimensions {
  const long = Math.max(size.width, size.height);
  if (!(long > maxLong)) return { width: size.width, height: size.height };
  const scale = maxLong / long;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** 変換した結果の候補 */
export interface Candidate<K extends string = string> {
  kind: K;
  size: number;
}

/**
 * 候補（作り直した画像）と元のうち、どれを送るか。いちばん小さいものを採る。
 * ただし元と同じ大きさ（縮めていない）の画像は、元より ATTACHMENT_MIN_GAIN 以上小さい候補があるときだけ作り直しを採る
 * （わずかな得のために世代劣化させない）。縮めた画像（resized）は、元より小さければ採る。
 * 元（kind "original"）を採るときは null
 */
export function pickSmallest<K extends string>(
  originalSize: number,
  candidates: ReadonlyArray<Candidate<K>>,
  opts: { resized: boolean },
): Candidate<K> | null {
  let best: Candidate<K> | null = null;
  for (const c of candidates) if (c.size > 0 && (best === null || c.size < best.size)) best = c;
  if (best === null) return null;
  if (opts.resized) return best.size < originalSize ? best : null;
  return best.size <= originalSize * (1 - ATTACHMENT_MIN_GAIN) ? best : null;
}

/** 作り直したときのファイル名: 拡張子を形式に合わせる（元の名前は originalName として別に残す） */
export function renamedFor(name: string, type: EncodedImageType): string {
  const ext = type === "image/avif" ? "avif" : "webp";
  const base = name.replace(/\.[^./\\]+$/, "").trim() || "image";
  return `${base}.${ext}`;
}

/** クリップボードから貼り付けた画像は名前が無い（または image.png）ので、日時から付ける */
export function nameForPasted(file: { name: string; type: string }, now: Date): string {
  const generic = /^(image|blob|untitled)\.[a-z0-9]+$/i.test(file.name);
  if (file.name && !generic) return file.name;
  const ext =
    extOf(file.name) || (guessImageMime(file).split("/")[1] ?? "png").replace("jpeg", "jpg");
  const p = (n: number) => String(n).padStart(2, "0");
  return `画像 ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.${ext}`;
}
