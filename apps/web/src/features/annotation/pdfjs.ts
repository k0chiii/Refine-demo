import * as pdfjs from "pdfjs-dist";
import { warmPdfAssets } from "@/lib/preload";
import type { ArtifactDownload } from "@/lib/artifactFiles";

/**
 * PDF.js 本体とワーカーの設定を 1 か所で。PDF を使うコード（PdfViewer・版比較の特徴抽出・自動校正の文字抜き出し）は
 * ここを（多くは動的に）import する。本体は約 400KB あるので、PDF の添付を開くまで読み込まない（lazyViewers）。
 * ワーカーの URL は Vite が別ファイルとして配信する。どこから最初に読み込まれても設定済みになるよう、ここで一度だけ設定する
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
warmPdfAssets();

export { pdfjs };

/**
 * 文字・フォント・画像コーデックの置き場（自前配信。SW が版をまたいで残す）。
 * PDF.js 5+ は JPEG2000 / JBIG2 / ICC（CMYK）を wasm に分けた。wasmUrl / iccUrl が無いと
 * 文字は出ても写真だけ空白になる（modern ビルド切替後の回帰）。
 * 範囲取得の単位（rangeChunkSize）は PDF.js の既定（64KB）のまま: 平らなページ木の PDF では全ページの定義を一斉に要求し、
 * 大きい単位だと要求のたびに余分なバイトを運ぶ（256KB にして計測したところ、1 ページ目までの時間は同じで転送量だけ増えた）
 */
export const pdfDocumentParams = {
  cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
  iccUrl: `${import.meta.env.BASE_URL}pdfjs/iccs/`,
  useSystemFonts: true,
} as const;

/** 届いた分を PDF.js に渡す前にまとめる大きさ・間隔（ネットワークの細かい断片を 1 つずつワーカーに送らない） */
const FLUSH_BYTES = 128 * 1024;
const FLUSH_MS = 60;

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.byteLength;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

/**
 * 受け取り中の添付を PDF.js に渡す。ファイルを全部受け取るのを待たず、先頭の数百 KB が届いた時点で文書を開き、
 * 1 ページ目から描ける（PDF.js が必要とする離れた箇所 — 末尾の索引など — は範囲取得で別に取る）。
 * - 全部手元にある（端末の写し・取得済み）、または範囲取得に応じないサーバーのときは、全体を渡す従来の経路
 * - 失敗（通信が切れて取り直せない）は onError で知らせる
 */
export async function openPdfFromDownload(
  download: ArtifactDownload,
  onError: (e: unknown) => void,
): Promise<pdfjs.PDFDocumentLoadingTask> {
  const whole = async () => {
    const blob = download.completed ?? (await download.blob);
    return pdfjs.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      ...pdfDocumentParams,
    });
  };
  await download.ready;
  if (download.completed || download.total === null || !download.rangeSupported) return whole();
  await download.firstBytes();

  let transport: ArtifactRangeTransport | null = null;
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pendingBytes === 0) return;
    const chunk = concat(pending);
    pending = [];
    pendingBytes = 0;
    transport?.onDataProgressiveRead(chunk);
  };
  const sub = download.subscribe({
    chunk(c) {
      pending.push(c);
      pendingBytes += c.byteLength;
      if (pendingBytes >= FLUSH_BYTES) flush();
      else timer ??= setTimeout(flush, FLUSH_MS);
    },
    end(err) {
      flush();
      if (err) onError(err);
      else transport?.onDataProgressiveDone();
    },
  });
  // ここまでに全部届いた
  if (!sub) return whole();

  transport = new ArtifactRangeTransport(download, download.total, concat(sub.initial), onError);
  return pdfjs.getDocument({ range: transport, ...pdfDocumentParams });
}

/** PDF.js の PDFDataRangeTransport: 離れた範囲の要求を、添付の範囲取得（または受け取り済みの分）で満たす */
class ArtifactRangeTransport extends pdfjs.PDFDataRangeTransport {
  constructor(
    private readonly download: ArtifactDownload,
    length: number,
    initial: Uint8Array,
    private readonly onError: (e: unknown) => void,
  ) {
    super(length, initial, false);
  }
  override requestDataRange(begin: number, end: number) {
    this.download
      .readRange(begin, end)
      .then((chunk) => this.onDataRange(begin, chunk))
      .catch((e: unknown) => this.onError(e));
  }
}
