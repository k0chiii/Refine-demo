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

export function guessMimeType(fileName: string, mime: string): string {
  if (mime) return mime;
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? "";
  return TEXT_EXT[ext] ?? "application/octet-stream";
}

export function guessArtifactType(
  fileName: string,
  mime: string,
): "pdf" | "image" | "document" | "other" {
  const m = guessMimeType(fileName, mime);
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("text/")) return "document";
  return "other";
}
