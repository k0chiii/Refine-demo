import {
  fileExtension,
  hasPdfSignature,
  PDF_SIGNATURE_WINDOW,
  sourceFormatMimeTypes,
} from "@mf100/domain";

/**
 * 提出ファイルの種類の判定（表示のしかたを決めるだけ。ファイル自体は変えずにそのまま保存する）。
 * ブラウザが MIME を付けないファイル（.md など）は拡張子で補う。
 * Word・Excel などは「document」を名前に含むが文字としては読めないので other（ダウンロードで確認）。
 */
const TEXT_EXT: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
  csv: "text/csv",
};
/** 動画（ブラウザが MIME を付けないことがある .mov・.m4v などを拡張子で補う） */
const VIDEO_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function guessMimeType(fileName: string, mime: string): string {
  // Illustrator・InDesign はブラウザが MIME を付けない・postscript や pdf を付けるので、拡張子から決める
  const source = sourceFormatMimeTypes[fileExtension(fileName)];
  if (source) return source;
  if (mime) return mime;
  const ext = fileExtension(fileName);
  return TEXT_EXT[ext] ?? VIDEO_EXT[ext] ?? "application/octet-stream";
}

/**
 * 種類。.ai / .indd は other（原本）。.ai が PDF として紙面に出せるかは実体の先頭を見て決める
 * （画面の案内は sniffPdfCompatible、確定する種類は Worker の検証）
 */
export function guessArtifactType(
  fileName: string,
  mime: string,
): "pdf" | "image" | "document" | "video" | "other" {
  const m = guessMimeType(fileName, mime);
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("text/")) return "document";
  if (m.startsWith("video/")) return "video";
  return "other";
}

/**
 * .ai の先頭を読み、PDF 互換（中身が PDF）かを調べる。画面で「紙面に出るファイル」を案内するための確認で、
 * 確定する種類は Worker が R2 に置いた実体を同じ規則で見て決める。読めなければ互換とは扱わない
 */
export async function sniffPdfCompatible(file: File): Promise<boolean> {
  try {
    const head = await file.slice(0, PDF_SIGNATURE_WINDOW).arrayBuffer();
    return hasPdfSignature(new Uint8Array(head));
  } catch {
    return false;
  }
}
