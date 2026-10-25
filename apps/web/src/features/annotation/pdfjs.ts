import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { warmPdfAssets } from "@/lib/preload";
import type { ArtifactDownload } from "@/lib/artifactFiles";

/**
 * PDF.js 本体とワーカーの設定を 1 か所で。PDF を使うコード（PdfViewer・版比較の特徴抽出・自動校正の文字抜き出し）は
 * ここを（多くは動的に）import する。本体は約 500KB あるので、PDF の添付を開くまで読み込まない（lazyViewers）。
 * ワーカーの URL は Vite が別ファイルとして配信する。どこから最初に読み込まれても設定済みになるよう、ここで一度だけ設定する
 *
 * **legacy ビルドを使う**（本体・ワーカーとも。2026-10-25）。modern ビルド（`pdfjs-dist` の既定）は最新のブラウザだけが対象で、
 * 読み込んだ瞬間に `Iterator` グローバル（Safari 18.4 以降・Chrome 122 以降）を無条件に触り、ワーカーは文書を開くたびに
 * `Uint8Array.prototype.toHex`（Safari 18.2 以降・Chrome 140 以降）を呼ぶ。それより古い端末では PDF が一切描けず
 * 「PDF を読み込めませんでした」になる（2026-10-23 の軽量化で modern に替えたあとの報告）。legacy ビルドはこれらを埋めてあり、
 * 差は本体＋ワーカーで圧縮後およそ 36KB（端末ごとに 1 回。/assets/ は SW が版をまたいで残す）。
 * どちらのビルドも `Promise.withResolvers`（Safari 17.4 以降・Chrome 119 以降）は要る。これより古い端末は PDF の対象外。
 * 回帰の確認: e2e/specs/pdf-legacy-browser.spec.ts（`Iterator` の無いブラウザを模して PDF を描く）
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
warmPdfAssets();

export { pdfjs };

/**
 * 文字・フォントのデータの置き場（自前配信。SW が版をまたいで残す）。
 * 範囲取得の単位（rangeChunkSize）は PDF.js の既定（64KB）のまま: 平らなページ木の PDF では全ページの定義を一斉に要求し、
 * 大きい単位だと要求のたびに余分なバイトを運ぶ（256KB にして計測したところ、1 ページ目までの時間は同じで転送量だけ増えた）
 */
export const pdfDocumentParams = {
  cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
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
