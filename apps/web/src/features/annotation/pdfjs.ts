import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * PDF.js 本体とワーカーの設定を 1 か所で。PDF を使うコード（PdfViewer・版比較の特徴抽出・自動校正の文字抜き出し）は
 * ここを（多くは動的に）import する。本体は約 400KB あるので、PDF の添付を開くまで読み込まない（lazyViewers）。
 * ワーカーの URL は Vite が別ファイルとして配信する。どこから最初に読み込まれても設定済みになるよう、ここで一度だけ設定する
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export { pdfjs };
