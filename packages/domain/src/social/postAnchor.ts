/**
 * SNS 投稿の校正画面（端末の枠に入れたプレビュー）で付けるコメントの位置（利用者指示 2026-10-17）。
 *
 * 位置は新しい種類を増やさず、既存のアンカーを SNS の版の中身に当てはめる。
 * - 本文: `text_range`。添付 `post-body.txt`（= 版の記録 `mf100-post.json` の `body`）の文字オフセット [start, end) と引用文。
 *   オフセットは JS の文字列（UTF-16）で数える。サロゲートペアの途中や、先頭・末尾の空白は含めない（normalizePostTextRange）
 * - 画像: `image_rect` / `image_pin`。アンカーの `artifactId` はその画像の添付で、座標は **元画像** を 0..1 とした正規化座標。
 *   端末の枠・拡大率・全画面・プレビューの切り抜き（比率と焦点）に依存しない。プレビューに描くときだけ、
 *   切り抜きの範囲（cropRect）に直す（rectToCrop / pointToCrop）。逆（描いた矩形 → 元画像）は rectFromCrop / pointFromCrop
 * 版は提出した時点の内容を固定した記録なので、アンカーは常に提出された版の本文・画像に対する値になる（編集中の下書きではない）。
 * 画像の番号（何枚目か）は保存しない。添付のファイル名と記録の画像の並びから引く（postImageIndex）。
 * 既存のアンカーと同じ形なので、添付の切り替えで開く文章・画像のビューアで付けたコメントもプレビューに出て、逆も同じ。
 */
import {
  TEXT_QUOTE_MAX,
  validateAnchor,
  type Anchor,
  type NormalizedPoint,
  type NormalizedRect,
} from "../comment/Anchor.ts";
import { POST_BODY_NAME, type SocialPost } from "./post.ts";

/** プレビューの位置の計算に要る添付の最小の形（id とファイル名） */
export interface PostArtifactRef {
  id: string;
  fileName: string;
}

/** 本文の添付（post-body.txt）。無ければ undefined（投稿でない版・本文の添付が無い古い版） */
export function postBodyArtifact<A extends Pick<PostArtifactRef, "fileName">>(
  artifacts: readonly A[],
): A | undefined {
  return artifacts.find((a) => a.fileName === POST_BODY_NAME);
}

/** 記録の画像（並びの順）に対応する添付。ファイル名で引く（無ければその位置は undefined） */
export function postImageArtifacts<A extends Pick<PostArtifactRef, "fileName">>(
  post: Pick<SocialPost, "images">,
  artifacts: readonly A[],
): Array<A | undefined> {
  const byName = new Map(artifacts.map((a) => [a.fileName, a] as const));
  return post.images.map((im) => byName.get(im.fileName));
}

/** 画像の添付が記録の何枚目か（0 始まり。記録にない添付は -1） */
export function postImageIndex(
  post: Pick<SocialPost, "images">,
  artifact: Pick<PostArtifactRef, "fileName">,
): number {
  return post.images.findIndex((im) => im.fileName === artifact.fileName);
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const isBlank = (ch: string) => /^\s$/u.test(ch);

/**
 * 本文の選択範囲を保存する形に整える。
 * - 本文の長さに収める
 * - サロゲートペア（絵文字など）の途中で切らない（外へ広げる）
 * - 先頭・末尾の空白と改行は含めない（引用文が空白だけにならないように）
 * 何も残らなければ null
 */
export function normalizePostTextRange(
  body: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  let s = Math.max(0, Math.min(Math.floor(Math.min(start, end)), body.length));
  let e = Math.max(0, Math.min(Math.ceil(Math.max(start, end)), body.length));
  if (s > 0 && isLow(body.charCodeAt(s)) && isHigh(body.charCodeAt(s - 1))) s -= 1;
  if (e < body.length && e > 0 && isLow(body.charCodeAt(e)) && isHigh(body.charCodeAt(e - 1)))
    e += 1;
  while (s < e && isBlank(body[s]!)) s += 1;
  while (e > s && isBlank(body[e - 1]!)) e -= 1;
  return e > s ? { start: s, end: e } : null;
}

/**
 * 本文の範囲のアンカーを作る（本文の添付 + 本文の範囲 + 引用文）。範囲が空なら null。
 * 引用文は先頭 TEXT_QUOTE_MAX 文字まで。
 */
export function postTextAnchor(
  bodyArtifactId: string,
  body: string,
  start: number,
  end: number,
): Extract<Anchor, { type: "text_range" }> | null {
  const r = normalizePostTextRange(body, start, end);
  if (!r) return null;
  const anchor: Extract<Anchor, { type: "text_range" }> = {
    type: "text_range",
    artifactId: bodyArtifactId,
    start: r.start,
    end: r.end,
    quote: body.slice(r.start, r.end).slice(0, TEXT_QUOTE_MAX),
  };
  validateAnchor(anchor);
  return anchor;
}

/**
 * 保存した本文の範囲を、いまの本文（版の記録）の上で探す。
 * 版の記録は版ごとに不変なので、ふつうはオフセットがそのまま合う（moved: false）。
 * 合わないとき（古いデータ・改行コードの違いなど）は、引用文が現れる位置のうち保存した位置に一番近いものを使う。
 * 見つからなければ null（プレビューには描かない）
 */
export function locateTextRange(
  body: string,
  a: { start: number; end: number; quote: string },
): { start: number; end: number; moved: boolean } | null {
  const { start, end, quote } = a;
  if (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= body.length &&
    body.startsWith(quote, start)
  )
    return { start, end, moved: false };
  if (!quote) return null;
  let best = -1;
  for (let i = body.indexOf(quote); i >= 0; i = body.indexOf(quote, i + 1))
    if (best < 0 || Math.abs(i - start) < Math.abs(best - start)) best = i;
  if (best < 0) return null;
  const len = Math.max(quote.length, Math.min(end - start, body.length - best));
  return { start: best, end: best + len, moved: true };
}

/** 画像の矩形がこれより小さければ、ドラッグではなくピン（クリック）として扱う（元画像に対する割合） */
export const POST_IMAGE_RECT_MIN = 0.01;

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/**
 * 画像の位置のアンカーを作る（元画像基準の正規化座標。範囲外は画像の中に収める）。
 * 矩形が小さすぎれば（どちらかの辺が POST_IMAGE_RECT_MIN 未満）その中心のピンにする
 */
export function postImageAnchor(
  imageArtifactId: string,
  shape: { rect: NormalizedRect } | { point: NormalizedPoint },
): Extract<Anchor, { type: "image_rect" | "image_pin" }> | null {
  let anchor: Extract<Anchor, { type: "image_rect" | "image_pin" }>;
  if ("rect" in shape) {
    const x0 = clamp01(Math.min(shape.rect.x, shape.rect.x + shape.rect.w));
    const x1 = clamp01(Math.max(shape.rect.x, shape.rect.x + shape.rect.w));
    const y0 = clamp01(Math.min(shape.rect.y, shape.rect.y + shape.rect.h));
    const y1 = clamp01(Math.max(shape.rect.y, shape.rect.y + shape.rect.h));
    if (![x0, x1, y0, y1].every(Number.isFinite)) return null;
    anchor =
      x1 - x0 < POST_IMAGE_RECT_MIN || y1 - y0 < POST_IMAGE_RECT_MIN
        ? {
            type: "image_pin",
            artifactId: imageArtifactId,
            point: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
          }
        : {
            type: "image_rect",
            artifactId: imageArtifactId,
            rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
          };
  } else {
    if (!Number.isFinite(shape.point.x) || !Number.isFinite(shape.point.y)) return null;
    anchor = {
      type: "image_pin",
      artifactId: imageArtifactId,
      point: { x: clamp01(shape.point.x), y: clamp01(shape.point.y) },
    };
  }
  validateAnchor(anchor);
  return anchor;
}

/** プレビューの位置の解決結果（アンカーが指す、記録の中の場所） */
export type PostAnchorTarget =
  | { kind: "text"; start: number; end: number; quote: string; moved: boolean }
  | {
      kind: "image";
      /** 記録の画像の並びでの位置（0 始まり） */
      index: number;
      key: string;
      rect?: NormalizedRect;
      point?: NormalizedPoint;
    };

/**
 * アンカーが、この版の記録（本文・画像）のどこを指すか。SNS の位置でなければ（別の種類・記録にない添付・本文が合わない）null。
 * - text_range: 本文の添付のもの。本文の上の範囲（locateTextRange）
 * - image_rect / image_pin: 記録の画像の添付のもの
 */
export function resolvePostAnchor(
  post: Pick<SocialPost, "body" | "images">,
  artifacts: readonly PostArtifactRef[],
  anchor: Anchor,
): PostAnchorTarget | null {
  const art = artifacts.find((a) => a.id === anchor.artifactId);
  if (!art) return null;
  if (anchor.type === "text_range") {
    if (art.fileName !== POST_BODY_NAME) return null;
    const at = locateTextRange(post.body, anchor);
    return at
      ? { kind: "text", start: at.start, end: at.end, quote: anchor.quote, moved: at.moved }
      : null;
  }
  if (anchor.type === "image_rect" || anchor.type === "image_pin") {
    const index = postImageIndex(post, art);
    const im = post.images[index];
    if (!im) return null;
    return {
      kind: "image",
      index,
      key: im.key,
      ...(anchor.type === "image_rect" ? { rect: anchor.rect } : { point: anchor.point }),
    };
  }
  return null;
}

/** 位置の表示用の名前（コメント入力欄・一覧の「場所」）。「本文」「2 枚目の画像」 */
export function postTargetLabel(target: PostAnchorTarget): string {
  return target.kind === "text" ? "本文" : `${target.index + 1} 枚目の画像`;
}

/** 元画像のうち、プレビューに見えている範囲（cropRect）。正規化座標 */
export type CropBox = NormalizedRect;

const EPS = 1e-9;

/**
 * 元画像の矩形 → プレビューの切り抜きの上の矩形（切り抜きを 0..1 とした座標）。
 * 切り抜きの外にはみ出す分は切る（clipped: true）。重ならなければ null
 */
export function rectToCrop(
  rect: NormalizedRect,
  crop: CropBox,
): { rect: NormalizedRect; clipped: boolean } | null {
  if (crop.w <= 0 || crop.h <= 0) return null;
  const x0 = Math.max(rect.x, crop.x);
  const y0 = Math.max(rect.y, crop.y);
  const x1 = Math.min(rect.x + rect.w, crop.x + crop.w);
  const y1 = Math.min(rect.y + rect.h, crop.y + crop.h);
  if (x1 - x0 <= EPS || y1 - y0 <= EPS) return null;
  return {
    rect: {
      x: (x0 - crop.x) / crop.w,
      y: (y0 - crop.y) / crop.h,
      w: (x1 - x0) / crop.w,
      h: (y1 - y0) / crop.h,
    },
    clipped:
      x0 > rect.x + EPS ||
      y0 > rect.y + EPS ||
      x1 < rect.x + rect.w - EPS ||
      y1 < rect.y + rect.h - EPS,
  };
}

/** 元画像の点 → 切り抜きの上の点。切り抜きの外なら null */
export function pointToCrop(point: NormalizedPoint, crop: CropBox): NormalizedPoint | null {
  if (crop.w <= 0 || crop.h <= 0) return null;
  const x = (point.x - crop.x) / crop.w;
  const y = (point.y - crop.y) / crop.h;
  return x < -EPS || x > 1 + EPS || y < -EPS || y > 1 + EPS
    ? null
    : { x: clamp01(x), y: clamp01(y) };
}

/** 切り抜きの上の矩形（プレビューで描いたもの）→ 元画像の矩形 */
export function rectFromCrop(rect: NormalizedRect, crop: CropBox): NormalizedRect {
  return {
    x: crop.x + rect.x * crop.w,
    y: crop.y + rect.y * crop.h,
    w: rect.w * crop.w,
    h: rect.h * crop.h,
  };
}

/** 切り抜きの上の点 → 元画像の点 */
export function pointFromCrop(point: NormalizedPoint, crop: CropBox): NormalizedPoint {
  return { x: crop.x + point.x * crop.w, y: crop.y + point.y * crop.h };
}
