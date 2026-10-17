import { DomainError } from "../shared/DomainError.ts";
import type { ArtifactId } from "../shared/ids.ts";
import { POST_MANIFEST_NAME } from "../social/post.ts";

/**
 * コメント位置（§5.2-8 / §9.1）。
 * - PDF: 1 始まりのページ番号 + ページ座標系（回転 0 の原本）に対する正規化矩形（0..1）。
 * - 画像: 原画像基準の正規化座標。トリミングや表示枠に依存しない。
 * - 文章（F-12 前倒し分）: 版スナップショット（添付テキスト）の文字オフセット [start, end) と引用文。
 *   引用文は表示・照合用で、スナップショットは版ごとに不変なのでオフセットは安定する。
 * - 動画: 再生位置（秒）。時点（start だけ）か時間の範囲 [start, end)。画面の上の位置（矩形かピン）も付けられる
 *   （座標は映像の原寸基準の 0..1）。Frame.io などの動画校正と同じく、時点・範囲・画面の位置の 3 つを 1 つのコメントで持つ。
 * - Web（ライブ表示。docs/FIGMA_WEB_PROOFING.md §6.1）: 外部リンクの添付（サイトの URL）の上で、ページの中の要素を
 *   CSS セレクタ・XPath・引用文で指し、要素の中の相対位置（矩形かピン。0..1）と、付けたときの端末幅（viewport）、
 *   見つからなかったときの文書座標（fallback）を持つ。表示時に要素を探し直す（resolveWebAnchor）。
 * - SNS 投稿（端末の枠のプレビュー。social/postAnchor.ts）: 新しい種類は作らず、本文の添付（post-body.txt）の text_range と、
 *   画像の添付の image_rect / image_pin（元画像基準の正規化座標）をそのまま使う
 * - Figma（埋め込み表示）: 埋め込みは位置を返さないので、コメントは「このフレーム（ノード）について」の単位（figma_node）。
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
  | { type: "text_range"; artifactId: ArtifactId; start: number; end: number; quote: string }
  | {
      type: "video_time";
      artifactId: ArtifactId;
      /** 再生位置（秒。ミリ秒まで） */
      start: number;
      /** 範囲の終わり（秒。無ければ時点） */
      end?: number;
      rect?: NormalizedRect;
      point?: NormalizedPoint;
    }
  | ({
      type: "web_element";
      /** role "external" の URL 添付（ライブ表示の対象） */
      artifactId: ArtifactId;
    } & WebElementPlace)
  | {
      type: "figma_node";
      /** Figma の URL の添付（external_link）。フレームごとに 1 つ */
      artifactId: ArtifactId;
      fileKey: string;
      nodeId: string;
      nodeName?: string;
    };

/** Web 要素の位置（アンカーのうち添付以外。ブリッジが返す値から作る） */
export interface WebElementPlace {
  /** パス＋クエリ（オリジンは添付の URL） */
  url: string;
  selector: WebSelector;
  /** 要素の境界ボックスの中の 0..1（矩形）。point と排他 */
  rect?: NormalizedRect;
  /** 要素の中の 0..1（ピン） */
  point?: NormalizedPoint;
  viewport: WebViewport;
  /** 文書座標（px）。要素が見つからないときの最後の手がかり */
  fallback: { pageX: number; pageY: number; scrollY: number };
}

export interface WebSelector {
  /** 一意になるよう生成した CSS セレクタ（id → nth-of-type の経路） */
  css: string;
  xpath?: string;
  /** 文字範囲のコメント・移動の検出に使う引用（W3C TextQuoteSelector） */
  textQuote?: { exact: string; prefix?: string; suffix?: string };
  tag: string;
}

export interface WebViewport {
  width: number;
  height: number;
  dpr: number;
  /** 端末プリセットの ID（devices.ts）。幅を直接入れたときは無い */
  deviceId?: string;
  orientation: "portrait" | "landscape";
}

/** CSS セレクタ・XPath・URL の長さの上限（壊れた値や巨大な値を保存しない） */
export const WEB_SELECTOR_MAX = 1000;
/** ビューポートの幅・高さの範囲（CSS ピクセル） */
export const WEB_VIEWPORT_MIN = 1;
export const WEB_VIEWPORT_MAX = 10000;

/** 動画の長さの上限（秒。12 時間）。これを超える再生位置は壊れた値として拒否する */
export const VIDEO_TIME_MAX = 12 * 60 * 60;

/** 再生位置をミリ秒に丸める（保存値。表示や比較で浮動小数の端数が出ないように） */
export function roundVideoTime(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}

function validTime(v: number): boolean {
  return Number.isFinite(v) && v >= 0 && v <= VIDEO_TIME_MAX;
}

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
    case "video_time":
      if (
        !validTime(anchor.start) ||
        (anchor.end !== undefined && (!validTime(anchor.end) || anchor.end <= anchor.start)) ||
        (anchor.rect !== undefined && anchor.point !== undefined) ||
        (anchor.rect !== undefined && !validRect(anchor.rect)) ||
        (anchor.point !== undefined && (!inUnit(anchor.point.x) || !inUnit(anchor.point.y)))
      )
        throw new DomainError("anchor_invalid", { anchor });
      return;
    case "web_element": {
      const s = anchor.selector;
      const vp = anchor.viewport;
      const q = s.textQuote;
      if (
        !shortText(anchor.url, WEB_SELECTOR_MAX) ||
        !anchor.url.startsWith("/") ||
        !shortText(s.css, WEB_SELECTOR_MAX) ||
        (s.xpath !== undefined && !shortText(s.xpath, WEB_SELECTOR_MAX)) ||
        !shortText(s.tag, 64) ||
        (q !== undefined &&
          (!shortText(q.exact, TEXT_QUOTE_MAX) ||
            (q.prefix !== undefined && q.prefix.length > TEXT_QUOTE_MAX) ||
            (q.suffix !== undefined && q.suffix.length > TEXT_QUOTE_MAX))) ||
        (anchor.rect !== undefined && anchor.point !== undefined) ||
        (anchor.rect !== undefined && !validRect(anchor.rect)) ||
        (anchor.point !== undefined && (!inUnit(anchor.point.x) || !inUnit(anchor.point.y))) ||
        !validViewportSize(vp.width) ||
        !validViewportSize(vp.height) ||
        !(Number.isFinite(vp.dpr) && vp.dpr > 0 && vp.dpr <= 8) ||
        (vp.orientation !== "portrait" && vp.orientation !== "landscape") ||
        (vp.deviceId !== undefined && !shortText(vp.deviceId, 64)) ||
        !Number.isFinite(anchor.fallback.pageX) ||
        !Number.isFinite(anchor.fallback.pageY) ||
        !Number.isFinite(anchor.fallback.scrollY)
      )
        throw new DomainError("anchor_invalid", { anchor });
      return;
    }
    case "figma_node":
      if (
        !shortText(anchor.fileKey, 128) ||
        !/^[A-Za-z0-9]+$/.test(anchor.fileKey) ||
        !shortText(anchor.nodeId, 64) ||
        !/^\d+[:-]\d+$/.test(anchor.nodeId) ||
        (anchor.nodeName !== undefined && anchor.nodeName.length > TEXT_QUOTE_MAX)
      )
        throw new DomainError("anchor_invalid", { anchor });
      return;
  }
}

const shortText = (s: unknown, max: number): boolean =>
  typeof s === "string" && s.length > 0 && s.length <= max;
const validViewportSize = (v: number) =>
  Number.isInteger(v) && v >= WEB_VIEWPORT_MIN && v <= WEB_VIEWPORT_MAX;

/**
 * 添付とアンカーの種類が合っているか（application 層の anchor_artifact_mismatch の判定）。
 * - web_element は URL の添付（role external・externalUrl あり）にだけ付く（ライブ表示の対象）
 * - figma_node は Figma の URL の添付にだけ付く
 * - external（外部での議論の記録）は role external の添付
 * - それ以外（PDF・画像・文章・動画の位置）は実体のある添付
 * 添付の種類（type）が分かるときは、位置の種類と合うことも確かめる（text_range は文章、image_* は画像）。SNS 投稿の版では、本文（post-body.txt）の範囲と各画像（元画像基準の矩形・ピン）がこれに当たり、
 * 内容の記録（mf100-post.json）そのものには位置を付けない。
 * 文章の範囲は添付のバイト数を超えない（UTF-16 の文字数はバイト数以下。サイズが分かるときだけ）
 */
export function anchorFitsArtifact(
  anchor: Anchor,
  artifact: {
    role: string;
    externalUrl?: string | undefined;
    type?: string | undefined;
    fileName?: string | undefined;
    size?: number | undefined;
  },
): boolean {
  const figma =
    typeof artifact.externalUrl === "string" &&
    /^https:\/\/(?:www\.)?figma\.com\//i.test(artifact.externalUrl);
  switch (anchor.type) {
    case "web_element":
      return (
        artifact.role === "external" &&
        typeof artifact.externalUrl === "string" &&
        /^https?:\/\//i.test(artifact.externalUrl) &&
        !figma
      );
    case "figma_node":
      return artifact.role === "external" && figma;
    case "external":
      return artifact.role === "external";
    default: {
      if (artifact.role === "external") return false;
      if (artifact.fileName === POST_MANIFEST_NAME) return false;
      const want = anchorArtifactType[anchor.type];
      if (artifact.type !== undefined && want !== undefined && artifact.type !== want) return false;
      if (
        anchor.type === "text_range" &&
        typeof artifact.size === "number" &&
        artifact.size > 0 &&
        anchor.end > artifact.size
      )
        return false;
      return true;
    }
  }
}

/** 位置の種類が付く添付の種類（文章の範囲と画像の位置だけ。PDF・動画の位置は従来どおり添付の種類を問わない） */
const anchorArtifactType: Partial<Record<Anchor["type"], string>> = {
  image_rect: "image",
  image_pin: "image",
  text_range: "document",
};

/**
 * Web 要素のアンカーを作る（ブリッジが返した位置から）。矩形があればピンは付けない。
 * 引用文は TEXT_QUOTE_MAX に、URL・セレクタは上限に切り詰める（検証は validateAnchor）
 */
export function webElementAnchor(
  artifactId: ArtifactId,
  place: WebElementPlace,
): Extract<Anchor, { type: "web_element" }> {
  const q = place.selector.textQuote;
  const selector: WebSelector = {
    css: place.selector.css.slice(0, WEB_SELECTOR_MAX),
    tag: place.selector.tag.toLowerCase().slice(0, 64),
    ...(place.selector.xpath ? { xpath: place.selector.xpath.slice(0, WEB_SELECTOR_MAX) } : {}),
    ...(q && q.exact.trim()
      ? {
          textQuote: {
            exact: q.exact.slice(0, TEXT_QUOTE_MAX),
            ...(q.prefix ? { prefix: q.prefix.slice(-TEXT_QUOTE_MAX) } : {}),
            ...(q.suffix ? { suffix: q.suffix.slice(0, TEXT_QUOTE_MAX) } : {}),
          },
        }
      : {}),
  };
  const vp: WebViewport = {
    width: Math.round(place.viewport.width),
    height: Math.round(place.viewport.height),
    dpr: place.viewport.dpr,
    orientation: place.viewport.orientation,
    ...(place.viewport.deviceId ? { deviceId: place.viewport.deviceId } : {}),
  };
  return {
    type: "web_element",
    artifactId,
    url: place.url.slice(0, WEB_SELECTOR_MAX),
    selector,
    viewport: vp,
    fallback: {
      pageX: Math.round(place.fallback.pageX),
      pageY: Math.round(place.fallback.pageY),
      scrollY: Math.round(place.fallback.scrollY),
    },
    ...(place.rect
      ? { rect: clampRect(place.rect) }
      : place.point
        ? { point: { x: clamp01(place.point.x), y: clamp01(place.point.y) } }
        : {}),
  };
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/**
 * 動画の位置のアンカーを作る。時刻はミリ秒に丸め、終わりが始まりと同じか前なら時点にする。
 * 画面の位置は矩形かピンのどちらか（両方あれば矩形）
 */
export function videoTimeAnchor(
  artifactId: ArtifactId,
  time: { start: number; end?: number | undefined },
  place: { rect?: NormalizedRect | undefined; point?: NormalizedPoint | undefined } = {},
): Extract<Anchor, { type: "video_time" }> {
  const start = roundVideoTime(Math.max(0, time.start));
  const end = time.end === undefined ? undefined : roundVideoTime(time.end);
  return {
    type: "video_time",
    artifactId,
    start,
    ...(end !== undefined && end > start ? { end } : {}),
    ...(place.rect ? { rect: place.rect } : place.point ? { point: place.point } : {}),
  };
}

/**
 * 再生位置の表示。既定は「m:ss」（1 時間以上は「h:mm:ss」）。precise では 1/100 秒まで（「m:ss.cc」）。
 * 範囲は「0:03–0:06」（formatVideoSpan）
 */
export function formatVideoTime(sec: number, precise = false): string {
  const t = Math.max(0, sec);
  const whole = precise ? Math.floor(t) : Math.floor(t + 1e-6);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (!precise) return base;
  const cs = Math.min(99, Math.floor((t - whole) * 100 + 1e-6));
  return `${base}.${pad(cs)}`;
}

/** 動画のアンカーの時刻の表示（時点は「0:03」、範囲は「0:03–0:06」） */
export function formatVideoSpan(a: { start: number; end?: number | undefined }): string {
  return a.end !== undefined
    ? `${formatVideoTime(a.start)}–${formatVideoTime(a.end)}`
    : formatVideoTime(a.start);
}

const pad = (n: number) => String(n).padStart(2, "0");

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
