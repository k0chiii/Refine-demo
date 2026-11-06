import { COMMENT_THUMB_MAX_BYTES } from "@mf100/domain";
import {
  ATTACHMENT_AVIF_TRY_ABOVE_BYTES,
  ATTACHMENT_MAX_LONG_SIDE,
  ATTACHMENT_QUALITY,
  ATTACHMENT_SKIP_RECODE_BELOW_BYTES,
  ATTACHMENT_THUMB_LONG_SIDE,
  ATTACHMENT_THUMB_QUALITY,
  fitWithin,
  pickSmallest,
  type Dimensions,
  type EncodedImageType,
} from "./attachmentCompress.core";

/**
 * 画像の変換の手順（環境を差し込む）。復号とキャンバスは `ImageEnv` の向こうにあり、ここは Node のテストでも動く。
 * - 復号は EXIF の向きを反映して（imageOrientation: from-image）行う。描き直した画像にメタデータ（位置情報など）は残らない。
 * - 本体: 長辺 2560 px 以内に縮め、WebP（品質 0.8）に、使える環境では AVIF にも作り直して、元を含めていちばん小さいものを採る。
 * - サムネイル: 長辺 480 px・品質 0.7 の WebP（WebP を作れない環境では JPEG）を必ず作る。
 */

/** 復号した画像 */
export interface ImageSource extends Dimensions {
  close(): void;
}

/** 描いた画像（縮小したキャンバス） */
export interface Surface extends Dimensions {
  /** type で書き出す。環境がその形式を作れず別の形式になったときは null */
  encode(type: string, quality: number): Promise<Blob | null>;
  /** この画像をさらに縮めて描く（段階的に縮めて、縮小の粗さを抑える） */
  resize(width: number, height: number): Surface;
  close(): void;
}

export interface ImageEnv {
  /** 復号できなければ例外（HEIC など）。向きは反映する */
  decode(blob: Blob): Promise<ImageSource>;
  draw(source: ImageSource, width: number, height: number): Surface;
  /** その形式でキャンバスから書き出せるか（環境ごとに 1 回だけ確かめる） */
  canEncode(type: string): Promise<boolean>;
}

export interface CompressOptions {
  /** 元のファイルの大きさ */
  originalSize: number;
  /**
   * 本体を作り直すか。auto: 大きさ・寸法に応じて決める。never: 元のまま（アニメーション GIF）。
   * force: 元のままでは画像として見せられない（HEIC・BMP）ので、小さくなるかに依らず作り直した画像を採る
   */
  recode: "auto" | "never" | "force";
}

export interface CompressedImage {
  /** 本体を作り直したとき。null なら元のファイルを送る */
  body: { blob: Blob; type: EncodedImageType } | null;
  /** 送る本体の幅・高さ（作り直したなら作り直した後、元のままなら元の大きさ） */
  width: number;
  height: number;
  /** 一覧用サムネイル。作れなかったときは null */
  thumb: { blob: Blob; type: "image/webp" | "image/jpeg" } | null;
  /** 変換の経過（計測・テスト用） */
  trace: { webpSize: number | null; avifSize: number | null; resized: boolean };
}

export async function compressImage(
  input: Blob,
  env: ImageEnv,
  opts: CompressOptions,
): Promise<CompressedImage> {
  const source = await env.decode(input);
  const surfaces: Surface[] = [];
  try {
    const target = fitWithin(source, ATTACHMENT_MAX_LONG_SIDE);
    const resized = target.width !== source.width || target.height !== source.height;
    const webpOk = await env.canEncode("image/webp");
    const trace: CompressedImage["trace"] = { webpSize: null, avifSize: null, resized };

    // 本体: 小さいままの画像は作り直さない（HEIC など画像として見せられないものと、縮める必要のあるものは別）
    const skip =
      opts.recode === "never" ||
      (opts.recode === "auto" &&
        !resized &&
        opts.originalSize < ATTACHMENT_SKIP_RECODE_BELOW_BYTES) ||
      !webpOk;
    let main: Surface | null = null;
    let body: CompressedImage["body"] = null;
    if (!skip) {
      main = env.draw(source, target.width, target.height);
      surfaces.push(main);
      const candidates: Array<{ kind: EncodedImageType; size: number; blob: Blob }> = [];
      const webp = await main.encode("image/webp", ATTACHMENT_QUALITY);
      if (webp) {
        trace.webpSize = webp.size;
        candidates.push({ kind: "image/webp", size: webp.size, blob: webp });
      }
      // AVIF は書き出せる環境だけ。WebP がすでに十分小さければ試さない（遅いわりに得が小さい）
      if (
        (!webp || webp.size > ATTACHMENT_AVIF_TRY_ABOVE_BYTES) &&
        (await env.canEncode("image/avif"))
      ) {
        const avif = await main.encode("image/avif", ATTACHMENT_QUALITY);
        if (avif) {
          trace.avifSize = avif.size;
          candidates.push({ kind: "image/avif", size: avif.size, blob: avif });
        }
      }
      const best =
        opts.recode === "force"
          ? (candidates.sort((a, b) => a.size - b.size)[0] ?? null)
          : pickSmallest(opts.originalSize, candidates, { resized });
      if (best) {
        const chosen = candidates.find((c) => c.kind === best.kind)!;
        body = { blob: chosen.blob, type: chosen.kind };
      }
    }
    const sent: Dimensions = body ? target : { width: source.width, height: source.height };

    // サムネイル: 本体用に描いた画像があれば、そこから段階的に縮める（なければ復号した画像から直接）
    const thumbSize = fitWithin(sent, ATTACHMENT_THUMB_LONG_SIDE);
    const thumbSurface = main ? main.resize(thumbSize.width, thumbSize.height) : null;
    const surface = thumbSurface ?? env.draw(source, thumbSize.width, thumbSize.height);
    surfaces.push(surface);
    const thumb = await encodeThumb(surface, webpOk);
    return { body, width: sent.width, height: sent.height, thumb, trace };
  } finally {
    for (const s of surfaces) s.close();
    source.close();
  }
}

/** WebP（品質 0.7）、作れなければ JPEG。上限（512 KB）を超えたら品質を下げて 1 回だけ作り直す。収まらなければ作らない */
async function encodeThumb(surface: Surface, webpOk: boolean): Promise<CompressedImage["thumb"]> {
  const type = webpOk ? "image/webp" : "image/jpeg";
  for (const quality of [ATTACHMENT_THUMB_QUALITY, 0.4]) {
    const blob = await surface.encode(type, quality);
    if (blob && blob.size > 0 && blob.size <= COMMENT_THUMB_MAX_BYTES) return { blob, type };
    if (!blob) return null;
  }
  return null;
}
