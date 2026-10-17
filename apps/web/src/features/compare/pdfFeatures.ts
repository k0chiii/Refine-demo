import type { NormalizedRect, PageFeature, PageLine } from "@mf100/domain";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

/**
 * PDF のページ特徴（版比較・自動校正で共用）。PDF.js でテキストを抜き、行・位置・縮小画像を作る。
 * 位置はページ基準の正規化座標（0..1）なので、表示倍率に依存しない。
 */
export interface PageTextItem {
  /** ページのテキスト（text）の中の範囲 */
  start: number;
  end: number;
  rect: NormalizedRect;
}

export interface PdfPageFeature extends PageFeature {
  lines: PageLine[];
  items: PageTextItem[];
}

const THUMB = 16;

/** ページを小さく描いて 16×16 の濃淡（0..1）にする */
async function thumbnail(page: PDFPageProxy): Promise<number[] | undefined> {
  if (typeof document === "undefined") return undefined;
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 64 / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  const small = document.createElement("canvas");
  small.width = THUMB;
  small.height = THUMB;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(canvas, 0, 0, THUMB, THUMB);
  const data = sctx.getImageData(0, 0, THUMB, THUMB).data;
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 4)
    out.push((0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!) / 255);
  return out;
}

interface RawItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function extractPageFeature(
  doc: PDFDocumentProxy,
  n: number,
  opts: { thumb: boolean } = { thumb: true },
): Promise<PdfPageFeature> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  // PDF.js 本体はここで静的に import しない（校正画面全体が引き込む）。features/annotation/pdfjs を動的に読む
  const { Util } = (await import("@/features/annotation/pdfjs")).pdfjs;
  const raw: RawItem[] = [];
  for (const it of content.items) {
    if (!("str" in it) || it.str === "") continue;
    const tx = Util.transform(vp.transform, it.transform);
    const h = Math.hypot(tx[2], tx[3]) || it.height || 10;
    raw.push({ str: it.str, x: tx[4], y: tx[5] - h, w: it.width * vp.scale, h });
  }
  // 行にまとめる（上から下、左から右）
  raw.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: RawItem[][] = [];
  for (const it of raw) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0]!.y - it.y) <= Math.max(2, it.h * 0.4)) row.push(it);
    else rows.push([it]);
  }
  let text = "";
  const lines: PageLine[] = [];
  const items: PageTextItem[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    if (text) text += "\n";
    const lineText = row.map((r) => r.str).join("");
    lines.push({ text: lineText, rel: Math.min(1, Math.max(0, row[0]!.y / vp.height)) });
    for (const r of row) {
      items.push({
        start: text.length,
        end: text.length + r.str.length,
        rect: {
          x: r.x / vp.width,
          y: r.y / vp.height,
          w: Math.max(0.001, r.w / vp.width),
          h: r.h / vp.height,
        },
      });
      text += r.str;
    }
  }
  const thumb = opts.thumb ? await thumbnail(page).catch(() => undefined) : undefined;
  return { page: n, text, lines, items, ...(thumb ? { thumb } : {}) };
}

const cache = new Map<string, Promise<PdfPageFeature[]>>();

/** 文書全体の特徴。添付 ID ごとに一度だけ計算する（縮小画像は 200 ページまで） */
export function pdfFeatures(key: string, doc: PDFDocumentProxy): Promise<PdfPageFeature[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const out: PdfPageFeature[] = [];
    for (let n = 1; n <= doc.numPages; n++)
      out.push(await extractPageFeature(doc, n, { thumb: doc.numPages <= 200 }));
    return out;
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

/** 平文の範囲 → そのページのテキスト項目の矩形（項目の一部だけなら幅を文字数で按分） */
export function rectsForRange(
  items: readonly PageTextItem[],
  start: number,
  end: number,
): NormalizedRect[] {
  const out: NormalizedRect[] = [];
  for (const it of items) {
    const s = Math.max(start, it.start);
    const e = Math.min(end, it.end);
    if (e <= s) continue;
    const len = Math.max(1, it.end - it.start);
    const x0 = it.rect.x + (it.rect.w * (s - it.start)) / len;
    const x1 = it.rect.x + (it.rect.w * (e - it.start)) / len;
    out.push({ x: x0, y: it.rect.y, w: Math.max(0.002, x1 - x0), h: it.rect.h });
  }
  return out;
}
