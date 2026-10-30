import type { ProofreadSegment } from "@mf100/domain";
import { extractPageFeature } from "@/features/compare/pdfFeatures";
import { documentView } from "@/features/writing/documentView";
import { fitWithin } from "./fitWithin";

/** PDF.js 本体（約 400KB）は PDF を扱うときだけ読み込む（校正画面を開いただけでは引き込まない）。ワーカーの設定も同じ場所 */
const loadPdfjs = () => import("@/features/annotation/pdfjs");

/**
 * 自動校正のために添付から文字と位置を取り出す（利用者の端末で行う。外部には送らない）。
 * - 文章: 校正画面と同じ平文（範囲指摘のオフセットと一致させる）
 * - PDF: PDF.js のテキスト（テキストが無いページは OCR に回す）
 * - 画像: OCR（tesseract.js・日本語。学習データはこのアプリから配信する）
 * 元のファイルは変更しない。
 */
export interface ArtifactRef {
  id: string;
  type: string;
  fileName: string;
  mimeType?: string;
}

export async function documentSegments(
  artifact: ArtifactRef,
  blob: Blob,
): Promise<ProofreadSegment[]> {
  const text = (await documentView(artifact, await blob.text())).body;
  return [{ kind: "text", text }];
}

const MAX_PAGES = 300;

export async function pdfSegments(
  blob: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<{ segments: ProofreadSegment[]; textless: number[] }> {
  const data = await blob.arrayBuffer();
  const { pdfjs, pdfDocumentParams } = await loadPdfjs();
  const task = pdfjs.getDocument({
    data,
    ...pdfDocumentParams,
  });
  const doc = await task.promise;
  const segments: ProofreadSegment[] = [];
  const textless: number[] = [];
  const total = Math.min(doc.numPages, MAX_PAGES);
  try {
    for (let n = 1; n <= total; n++) {
      const f = await extractPageFeature(doc, n, { thumb: false });
      if (f.text.trim().length < 2) textless.push(n);
      else segments.push({ kind: "page", page: n, text: f.text, boxes: f.items });
      onProgress?.(n, total);
      // 長い PDF で画面が固まらないよう、ページごとに一度手を離す
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    void task.destroy();
  }
  return { segments, textless };
}

interface OcrResult {
  text: string;
  boxes: Array<{
    start: number;
    end: number;
    rect: { x: number; y: number; w: number; h: number };
  }>;
  confidence: number;
}

type OcrWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

/** OCR のワーカー（tesseract.js・日本語）。学習データ等はこのアプリから配信する（外部に送らない） */
async function ocrWorker(onProgress?: (ratio: number) => void): Promise<OcrWorker> {
  const { createWorker, OEM } = await import("tesseract.js");
  const base = `${location.origin}${import.meta.env.BASE_URL}ocr/`;
  return createWorker("jpn", OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    // ディレクトリだと relaxed SIMD / SIMD / 非 SIMD の 3 本を取りに行く。配るのはこの 1 本。
    corePath: `${base}core/tesseract-core-simd-lstm.wasm.js`,
    langPath: `${base}lang/`,
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(m.progress);
    },
  });
}

/** 画像を OCR し、行ごとの文字と位置（画像に対する正規化座標）を返す */
async function ocr(
  worker: OcrWorker,
  image: HTMLCanvasElement,
  W: number,
  H: number,
): Promise<OcrResult> {
  const { data } = await worker.recognize(image, {}, { blocks: true });
  let text = "";
  const boxes: OcrResult["boxes"] = [];
  let confSum = 0;
  let confN = 0;
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs)
      for (const line of para.lines) {
        if (text) text += "\n";
        for (const w of line.words) {
          // 日本語は単語の間に空白を入れない
          const s = w.text.replace(/\s+/g, "");
          if (!s) continue;
          boxes.push({
            start: text.length,
            end: text.length + s.length,
            rect: {
              x: w.bbox.x0 / W,
              y: w.bbox.y0 / H,
              w: Math.max(1, w.bbox.x1 - w.bbox.x0) / W,
              h: Math.max(1, w.bbox.y1 - w.bbox.y0) / H,
            },
          });
          text += s;
          confSum += w.confidence;
          confN++;
        }
      }
  return { text, boxes, confidence: confN ? confSum / confN / 100 : 0 };
}

/** OCR に渡す画像の長辺の上限（大きな写真で端末のメモリを使い切らない） */
const OCR_IMAGE_MAX_SIDE = 3000;

/**
 * 画像の OCR。信頼度の低い文字は誤りと断定しない（エンジン側で要確認にする）。
 * 元のファイルをそのまま渡すと、OCR エンジンが読めない形式（Safari の HEIC・AVIF など）で失敗するため、
 * ブラウザで復号して canvas に描いてから渡す。
 */
export async function imageSegments(
  blob: Blob,
  onProgress?: (ratio: number) => void,
): Promise<ProofreadSegment[]> {
  const worker = await ocrWorker(onProgress);
  const canvas = document.createElement("canvas");
  try {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, OCR_IMAGE_MAX_SIDE);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    // 透明な部分を白にする（透明のままだと黒として読まれ、黒い文字が消える）
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    // 座標は描いた大きさで割るので、縮めても元の画像に対する正規化座標のまま
    const r = await ocr(worker, canvas, width, height);
    if (!r.text.trim()) return [];
    return [{ kind: "image", text: r.text, boxes: r.boxes, confidence: r.confidence }];
  } finally {
    // Safari は canvas のメモリをすぐには返さないため、使い終えたら大きさを 0 にする
    canvas.width = 0;
    canvas.height = 0;
    await worker.terminate();
  }
}

/** 文字の無い PDF のページ（スキャンなど）を描画して OCR する（ページ数の上限つき） */
export const OCR_PDF_PAGES_MAX = 20;
export async function pdfOcrSegments(
  blob: Blob,
  pages: readonly number[],
  onProgress?: (done: number, total: number) => void,
): Promise<ProofreadSegment[]> {
  const target = pages.slice(0, OCR_PDF_PAGES_MAX);
  if (!target.length) return [];
  const { pdfjs, pdfDocumentParams } = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: await blob.arrayBuffer(),
    ...pdfDocumentParams,
  });
  const doc = await task.promise;
  const worker = await ocrWorker();
  const out: ProofreadSegment[] = [];
  try {
    for (const [i, n] of target.entries()) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      const r = await ocr(worker, canvas, canvas.width, canvas.height);
      if (r.text.trim())
        out.push({
          kind: "page",
          page: n,
          text: r.text,
          boxes: r.boxes,
          ocrConfidence: r.confidence,
        });
      onProgress?.(i + 1, target.length);
    }
  } finally {
    await worker.terminate();
    void task.destroy();
  }
  return out;
}
