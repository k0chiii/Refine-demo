import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";

/** PDF の中のリンク 1 つ（ページに対する割合 0..1 の四角） */
interface PdfLink {
  left: number;
  top: number;
  width: number;
  height: number;
  /** 外部の URL（http・https・mailto・tel だけ。それ以外は出さない） */
  url?: string;
  /** ページ内の移動先（名前付き移動先、または [ページ参照, …] の配列） */
  dest?: unknown;
  /** 「次のページ」などの名前付き操作 */
  action?: string;
}

/** 開いてよい外部リンクの種類（javascript: などは出さない） */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/** 外部リンクとして開いてよい URL か（開くのは新しいタブ。noopener noreferrer） */
export function safeExternalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return SAFE_PROTOCOLS.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** ページごとに 1 回だけ読む（拡大・縮小のたびに読み直さない） */
const cache = new WeakMap<PDFDocumentProxy, Map<string, Promise<PdfLink[]>>>();

function loadLinks(doc: PDFDocumentProxy, n: number, rotation: number): Promise<PdfLink[]> {
  let byPage = cache.get(doc);
  if (!byPage) cache.set(doc, (byPage = new Map()));
  const key = `${n}:${rotation}`;
  let hit = byPage.get(key);
  if (!hit) {
    hit = (async () => {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
      const annotations = await page.getAnnotations({ intent: "display" });
      const out: PdfLink[] = [];
      for (const a of annotations) {
        if (a.subtype !== "Link" || !Array.isArray(a.rect)) continue;
        const r = a.rect as number[];
        const [x1, y1] = vp.convertToViewportPoint(r[0]!, r[1]!) as [number, number];
        const [x2, y2] = vp.convertToViewportPoint(r[2]!, r[3]!) as [number, number];
        const box = {
          left: Math.min(x1, x2) / vp.width,
          top: Math.min(y1, y2) / vp.height,
          width: Math.abs(x2 - x1) / vp.width,
          height: Math.abs(y2 - y1) / vp.height,
        };
        const url = typeof a.url === "string" ? safeExternalUrl(a.url) : null;
        if (url) out.push({ ...box, url });
        else if (a.dest !== undefined && a.dest !== null) out.push({ ...box, dest: a.dest });
        else if (typeof a.action === "string") out.push({ ...box, action: a.action });
      }
      return out;
    })().catch(() => []);
    byPage.set(key, hit);
  }
  return hit;
}

/** 移動先（名前付き・配列）を、ページ番号（1 始まり）にする。分からなければ null */
async function destinationPage(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const ref = explicit[0] as unknown;
    if (typeof ref === "number") return ref + 1;
    if (ref && typeof ref === "object") return (await doc.getPageIndex(ref as never)) + 1;
    return null;
  } catch {
    return null;
  }
}

/**
 * PDF の中のリンク（PDF.js の Link の注釈）を、ページの上に本物の `<a>` として重ねる
 * （利用者指示 2026-10-17「PDF中のリンクとか押せたらありがたい」。2026-10-20 からは、クリックがいつもふつうのクリックなので常に出す）。
 * - 外部の URL: 新しいタブで開く（`rel="noopener noreferrer"`）。http・https・mailto・tel のほかは出さない
 * - ページ内の移動先・「次のページ」などの操作: そのページへ移る（onGoto）
 * - 位置はページに対する割合なので、拡大・縮小しても canvas（描く大きさは別）と同じ場所に重なる
 * - 重なりの順は canvas ＜ このリンク ＜ 印の層（AnchorOverlay）。印の層は押す・なぞるを通すので、リンクはそのまま押せる。
 *   リンクの上からなぞる・長押しすると、リンクは辿らずコメントになる
 */
export function PdfLinks({
  doc,
  n,
  rotation,
  numPages,
  onGoto,
}: {
  doc: PDFDocumentProxy;
  n: number;
  rotation: number;
  numPages: number;
  onGoto: (page: number) => void;
}) {
  const [links, setLinks] = useState<PdfLink[]>([]);
  useEffect(() => {
    let cancelled = false;
    void loadLinks(doc, n, rotation).then((l) => {
      if (!cancelled) setLinks(l);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, n, rotation]);
  if (links.length === 0) return null;
  const pct = (v: number) => `${(v * 100).toFixed(4)}%`;
  const act = (link: PdfLink): number | null => {
    if (link.action === "NextPage") return Math.min(numPages, n + 1);
    if (link.action === "PrevPage") return Math.max(1, n - 1);
    if (link.action === "FirstPage") return 1;
    if (link.action === "LastPage") return numPages;
    return null;
  };
  return (
    <div className="pdf-links">
      {links.map((l, i) => {
        const style = {
          left: pct(l.left),
          top: pct(l.top),
          width: pct(l.width),
          height: pct(l.height),
        };
        if (l.url)
          return (
            <a
              key={i}
              className="pdf-link"
              style={style}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`リンク（新しいタブ）: ${l.url}`}
              title={l.url}
            />
          );
        const target = act(l);
        if (l.action && target === null) return null;
        return (
          <a
            key={i}
            className="pdf-link"
            style={style}
            href={`#page-${target ?? "link"}`}
            aria-label={target !== null ? `${target} ページへ移動` : "ページ内のリンク"}
            onClick={(e) => {
              e.preventDefault();
              if (target !== null) onGoto(target);
              else
                void destinationPage(doc, l.dest).then((p) => p && onGoto(Math.min(numPages, p)));
            }}
          />
        );
      })}
    </div>
  );
}
