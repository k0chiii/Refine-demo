import { DomainError } from "../shared/DomainError.ts";
import type { ArtifactId } from "../shared/ids.ts";

/**
 * コメント位置（§5.2-8 / §9.1）。
 * - PDF: 1 始まりのページ番号 + ページ座標系（回転 0 の原本）に対する正規化矩形（0..1）。
 * - 画像: 原画像基準の正規化座標。トリミングや表示枠に依存しない。
 * - 文章（F-12 前倒し分）: 版スナップショット（添付テキスト）の文字オフセット [start, end) と引用文。
 *   引用文は表示・照合用で、スナップショットは版ごとに不変なのでオフセットは安定する。
 * 保存値はプレビューの拡大率・回転・ビューポート幅に依存しない（A-03）。
 */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface NormalizedPoint {
  x: number;
  y: number;
}

export type Anchor =
  | { type: "pdf_rect"; artifactId: ArtifactId; page: number; rect: NormalizedRect }
  | { type: "pdf_pin"; artifactId: ArtifactId; page: number; point: NormalizedPoint }
  | { type: "image_rect"; artifactId: ArtifactId; rect: NormalizedRect }
  | { type: "image_pin"; artifactId: ArtifactId; point: NormalizedPoint }
  | { type: "external"; artifactId: ArtifactId; note: string }
  | { type: "text_range"; artifactId: ArtifactId; start: number; end: number; quote: string };

/** 引用文の最大長（保存容量とスレッド表示の都合。範囲自体はオフセットで保持する） */
export const TEXT_QUOTE_MAX = 200;

function inUnit(v: number): boolean {
  return Number.isFinite(v) && v >= 0 && v <= 1;
}

function validRect(r: NormalizedRect): boolean {
  return (
    inUnit(r.x) &&
    inUnit(r.y) &&
    r.w > 0 &&
    r.h > 0 &&
    r.x + r.w <= 1 + 1e-9 &&
    r.y + r.h <= 1 + 1e-9
  );
}

export function validateAnchor(anchor: Anchor): void {
  switch (anchor.type) {
    case "pdf_rect":
      if (!Number.isInteger(anchor.page) || anchor.page < 1 || !validRect(anchor.rect))
        throw new DomainError("anchor_invalid", { anchor });
      return;
    case "pdf_pin":
      if (
        !Number.isInteger(anchor.page) ||
        anchor.page < 1 ||
        !inUnit(anchor.point.x) ||
        !inUnit(anchor.point.y)
      )
        throw new DomainError("anchor_invalid", { anchor });
      return;
    case "image_rect":
      if (!validRect(anchor.rect)) throw new DomainError("anchor_invalid", { anchor });
      return;
    case "image_pin":
      if (!inUnit(anchor.point.x) || !inUnit(anchor.point.y))
        throw new DomainError("anchor_invalid", { anchor });
      return;
    case "external":
      return;
    case "text_range":
      if (
        !Number.isInteger(anchor.start) ||
        !Number.isInteger(anchor.end) ||
        anchor.start < 0 ||
        anchor.end <= anchor.start ||
        anchor.quote.length === 0 ||
        anchor.quote.length > TEXT_QUOTE_MAX
      )
        throw new DomainError("anchor_invalid", { anchor });
      return;
  }
}

/** 文章スナップショットから text_range アンカーを作る（引用文は先頭 TEXT_QUOTE_MAX 文字に切り詰め）。 */
export function textRangeAnchor(
  artifactId: ArtifactId,
  text: string,
  start: number,
  end: number,
): Extract<Anchor, { type: "text_range" }> {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  return {
    type: "text_range",
    artifactId,
    start: s,
    end: e,
    quote: text.slice(s, e).slice(0, TEXT_QUOTE_MAX),
  };
}

/** 表示ビューポート（回転後の描画サイズ）。rotation は PDF.js と同じく時計回り度数。 */
export interface Viewport {
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 回転 0 の正規化座標 → 回転後ビューポートのピクセル矩形。 */
export function toViewportRect(rect: NormalizedRect, vp: Viewport): PixelRect {
  // 回転後の正規化矩形（回転後の幅・高さは vp に既に反映されている前提）
  let r: NormalizedRect;
  switch (vp.rotation) {
    case 0:
      r = rect;
      break;
    case 90:
      r = { x: 1 - (rect.y + rect.h), y: rect.x, w: rect.h, h: rect.w };
      break;
    case 180:
      r = { x: 1 - (rect.x + rect.w), y: 1 - (rect.y + rect.h), w: rect.w, h: rect.h };
      break;
    case 270:
      r = { x: rect.y, y: 1 - (rect.x + rect.w), w: rect.h, h: rect.w };
      break;
  }
  return { x: r.x * vp.width, y: r.y * vp.height, w: r.w * vp.width, h: r.h * vp.height };
}

/** 回転後ビューポートのピクセル矩形 → 回転 0 の正規化座標（toViewportRect の逆）。 */
export function fromViewportRect(px: PixelRect, vp: Viewport): NormalizedRect {
  const r: NormalizedRect = {
    x: px.x / vp.width,
    y: px.y / vp.height,
    w: px.w / vp.width,
    h: px.h / vp.height,
  };
  let out: NormalizedRect;
  switch (vp.rotation) {
    case 0:
      out = r;
      break;
    case 90:
      out = { x: r.y, y: 1 - (r.x + r.w), w: r.h, h: r.w };
      break;
    case 180:
      out = { x: 1 - (r.x + r.w), y: 1 - (r.y + r.h), w: r.w, h: r.h };
      break;
    case 270:
      out = { x: 1 - (r.y + r.h), y: r.x, w: r.h, h: r.w };
      break;
  }
  return clampRect(out);
}

export function clampRect(r: NormalizedRect): NormalizedRect {
  const x = Math.min(Math.max(r.x, 0), 1);
  const y = Math.min(Math.max(r.y, 0), 1);
  return { x, y, w: Math.min(Math.max(r.w, 0), 1 - x), h: Math.min(Math.max(r.h, 0), 1 - y) };
}
