import type { Anchor, NormalizedRect, WebViewport } from "../comment/Anchor.ts";
import { clampRect, TEXT_QUOTE_MAX } from "../comment/Anchor.ts";

/**
 * Web のライブ表示の校正（docs/FIGMA_WEB_PROOFING.md §3.3・§6.1）。
 * ブリッジ（サイト側のスクリプト）は「要素の候補とその矩形」を返すだけで、
 * どの候補を採るか・位置が外れたかの判断（再アンカー）はここで行う。
 */
export type WebAnchor = Extract<Anchor, { type: "web_element" }>;

/** 文書座標（px）の矩形（ページの左上が原点。スクロールに依らない） */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ブリッジが返す候補（CSS セレクタで見つけた・XPath で見つけた・引用文で見つけた） */
export interface WebAnchorCandidate {
  by: "css" | "xpath" | "text";
  /** 要素の境界ボックス（文書座標） */
  rect: PageRect;
  /** 要素の文字（先頭 TEXT_QUOTE_MAX 文字。引用文との照合用） */
  text?: string;
}

/**
 * 再アンカーの結果。
 * - attached: セレクタで見つかった（CSS → XPath の順）
 * - moved: セレクタでは見つからず、引用文で見つかった（文章が動いた・構造が変わった）
 * - detached: 見つからない。保存した文書座標（fallback）に印を出す
 */
export type WebAnchorState = "attached" | "moved" | "detached";

export interface ResolvedWebAnchor {
  state: WebAnchorState;
  /** 印を出す場所（文書座標）。detached は fallback の点 */
  rect: PageRect;
}

/** 照合用の文字: 空白は全部取り（日本語は語の間に空白を置かない）、大文字小文字は見ない */
const normalizeText = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/**
 * 候補から印の場所を決める。セレクタで見つかった要素でも、引用文があってその文字が要素に無ければ
 * 「文章が入れ替わった」とみなし、引用文で見つかった候補を優先する（それも無ければ moved 扱いでセレクタの要素に出す）
 */
export function resolveWebAnchor(
  anchor: WebAnchor,
  candidates: readonly WebAnchorCandidate[],
): ResolvedWebAnchor {
  const quote = anchor.selector.textQuote?.exact;
  const q = quote ? normalizeText(quote) : null;
  const hasQuote = (c: WebAnchorCandidate) =>
    q === null || c.text === undefined || normalizeText(c.text).includes(q);
  const bySelector =
    candidates.find((c) => c.by === "css") ?? candidates.find((c) => c.by === "xpath");
  const byText = candidates.find((c) => c.by === "text");
  if (bySelector && hasQuote(bySelector))
    return { state: "attached", rect: placeIn(anchor, bySelector.rect) };
  if (byText) return { state: "moved", rect: placeIn(anchor, byText.rect) };
  if (bySelector) return { state: "moved", rect: placeIn(anchor, bySelector.rect) };
  return {
    state: "detached",
    rect: { x: anchor.fallback.pageX, y: anchor.fallback.pageY, w: 0, h: 0 },
  };
}

/** 要素の矩形の中の相対位置（rect / point）を文書座標に直す。どちらも無ければ要素全体 */
export function placeIn(anchor: Pick<WebAnchor, "rect" | "point">, element: PageRect): PageRect {
  if (anchor.rect)
    return {
      x: element.x + anchor.rect.x * element.w,
      y: element.y + anchor.rect.y * element.h,
      w: anchor.rect.w * element.w,
      h: anchor.rect.h * element.h,
    };
  if (anchor.point)
    return {
      x: element.x + anchor.point.x * element.w,
      y: element.y + anchor.point.y * element.h,
      w: 0,
      h: 0,
    };
  return element;
}

/** 文書座標の矩形を、要素の中の 0..1 に直す（ブリッジが返した要素の矩形と選んだ範囲から） */
export function relativeTo(element: PageRect, target: PageRect): NormalizedRect {
  if (element.w <= 0 || element.h <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  return clampRect({
    x: (target.x - element.x) / element.w,
    y: (target.y - element.y) / element.h,
    w: target.w / element.w,
    h: target.h / element.h,
  });
}

/**
 * 文書座標の矩形を、いま見えている範囲（スクロール位置とビューポートの大きさ）の 0..1 に直す。
 * 見えている範囲と重ならなければ null（画面の外の印は描かない）
 */
export function toViewportUnit(
  rect: PageRect,
  scroll: { x: number; y: number },
  size: { width: number; height: number },
): NormalizedRect | null {
  if (size.width <= 0 || size.height <= 0) return null;
  const x = rect.x - scroll.x;
  const y = rect.y - scroll.y;
  // 点（w・h が 0）は見えている範囲に入っていれば描く。矩形は少しでも重なれば描く（はみ出しは切る）
  if (x + rect.w < 0 || y + rect.h < 0 || x > size.width || y > size.height) return null;
  const x0 = Math.max(x, 0);
  const y0 = Math.max(y, 0);
  const x1 = Math.min(x + rect.w, size.width);
  const y1 = Math.min(y + rect.h, size.height);
  return clampRect({
    x: x0 / size.width,
    y: y0 / size.height,
    w: (x1 - x0) / size.width,
    h: (y1 - y0) / size.height,
  });
}

/** 付けたときの端末幅の表示: 「iPhone 17（402px）」「幅 1440px」 */
export function formatWebViewport(vp: WebViewport, deviceLabel?: string | null): string {
  const w = vp.orientation === "landscape" ? Math.max(vp.width, vp.height) : vp.width;
  return deviceLabel ? `${deviceLabel}（${w}px）` : `幅 ${w}px`;
}

/** 場所の短い表示: 「iPhone 17（402px）・h2.title」。引用文があれば「…・「見出し」」 */
export function formatWebPlace(a: WebAnchor, deviceLabel?: string | null): string {
  const q = a.selector.textQuote?.exact.replace(/\s+/g, " ").trim();
  const where = q
    ? `「${q.length > 16 ? `${q.slice(0, 15)}…` : q}」`
    : shortSelector(a.selector.css, a.selector.tag);
  return `${formatWebViewport(a.viewport, deviceLabel)}・${where}`;
}

/** セレクタの末尾だけ（`main > section:nth-of-type(2) > h2` → `h2`、`#hero > .title` → `.title`） */
export function shortSelector(css: string, tag: string): string {
  const last =
    css
      .split(/\s*>\s*|\s+/)
      .filter(Boolean)
      .pop() ?? tag;
  const cleaned = last.replace(/:nth-of-type\(\d+\)/g, "");
  return cleaned.length > 40 ? tag : cleaned || tag;
}

/** 引用文の長さの上限（ブリッジで切る値と同じ） */
export const WEB_QUOTE_MAX = TEXT_QUOTE_MAX;

/**
 * Web の校正のポリシー値（承認待ちの項目はコードで確定しない。CLAUDE.md）。
 * - snapshotEnabled: 提出確定時のスクリーンショット（Cloudflare Browser Rendering。課金の承認後）
 * - allowedProxyHosts: プロキシ表示を許すホスト（承認後に設定。空なら無効）
 * - defaultDevices: ライブ表示の既定の端末（Q5: スマホ 1 種＋PC 1 種）
 * - allowRestricted: 取扱注意の制作物の URL を外部（撮影・プロキシ）へ送るか
 */
export interface WebProofPolicy {
  snapshotEnabled: boolean;
  allowedProxyHosts: readonly string[];
  defaultDevices: readonly string[];
  allowRestricted: boolean;
}

export const defaultWebProofPolicy: WebProofPolicy = {
  snapshotEnabled: false,
  allowedProxyHosts: [],
  defaultDevices: ["iphone-17", "pc-1440"],
  allowRestricted: false,
};
