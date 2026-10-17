import type { Anchor } from "@mf100/domain";

/**
 * 位置（アンカー）が指す PDF のページ（PDF 以外は null）。
 * PdfViewer から分けてある: 校正画面は PDF.js（約 400KB）を使う添付を開くまで読み込まない（lazyViewers）。
 * この関数だけは紙面の種類を問わず使うので、PDF.js を引き込まない小さなモジュールに置く。
 */
export function anchorPage(anchor: Anchor): number | null {
  return anchor.type === "pdf_rect" || anchor.type === "pdf_pin" ? anchor.page : null;
}
