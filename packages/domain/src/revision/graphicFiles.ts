/**
 * グラフィック制作物（印刷物・画像）の提出ファイル（利用者指示 2026-10-19「グラフィック制作物の場合、pdf, adobe illustrator,
 * indesign のファイルもあげれるようにして欲しい」）。
 * - PDF・画像: これまでどおり紙面に出してコメントを付ける。
 * - .ai: 「PDF 互換ファイルを作成」で保存されたものは中身が PDF なので、実体の先頭で見分けて PDF として紙面に出せる。
 *   互換でなければ保管・ダウンロードだけ。
 * - .indd: ブラウザでは描けない。保管・ダウンロードだけ。
 * 実体を見るのは Worker（R2 に置いた直後）。ここは先頭のバイト列の見分け方と拡張子の規則だけを持つ（入出力を持たない）。
 */
import type { MediaType } from "../work/Work.ts";
import type { ArtifactType } from "./Artifact.ts";

/** グラフィック制作物の媒体。印刷物は PDF、Web バナーなどは画像で出す（どちらも同じ受け入れ） */
export const graphicMediaTypes: readonly MediaType[] = ["pdf", "image"];

export function isGraphicMediaType(mediaType: string | undefined): boolean {
  return mediaType !== undefined && (graphicMediaTypes as readonly string[]).includes(mediaType);
}

/** 拡張子（小文字。無ければ空） */
export function fileExtension(fileName: string): string {
  return /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? "";
}

/** 紙面に出さない原本として受ける制作ソフトの形式（拡張子 → MIME。ブラウザが付ける MIME は当てにならない） */
export const sourceFormatMimeTypes: Readonly<Record<string, string>> = {
  ai: "application/illustrator",
  indd: "application/x-indesign",
};

export function isIllustratorFile(fileName: string): boolean {
  return fileExtension(fileName) === "ai";
}

export function isInDesignFile(fileName: string): boolean {
  return fileExtension(fileName) === "indd";
}

/** Illustrator / InDesign の原本か */
export function isSourceFormatFile(fileName: string): boolean {
  return fileExtension(fileName) in sourceFormatMimeTypes;
}

/**
 * グラフィック制作物の提出で受けるファイルか（PDF・画像・Illustrator・InDesign）。
 * 画面の選択・ドロップで使う。サーバーは種類で拒まない（保存して配信できる）。
 */
export function isGraphicSubmissionFile(f: { fileName: string; mimeType: string }): boolean {
  const mime = f.mimeType.toLowerCase();
  const ext = fileExtension(f.fileName);
  return (
    mime === "application/pdf" ||
    mime.startsWith("image/") ||
    ext === "pdf" ||
    ext in sourceFormatMimeTypes
  );
}

/**
 * 提出時に申告された MIME と種類を正す。.ai / .indd はブラウザが MIME を付けない・別の MIME（postscript や pdf）を付けるので、
 * 拡張子から決める。種類は other で始め、.ai は実体の先頭を見て PDF と分かったときだけ PDF にする（resolveStoredType）。
 */
export function normalizeDeclaredFile<
  T extends { fileName: string; mimeType: string; type: ArtifactType },
>(item: T): T {
  const mime = sourceFormatMimeTypes[fileExtension(item.fileName)];
  return mime ? { ...item, mimeType: mime, type: "other" } : item;
}

/** PDF の見出し `%PDF-` を探す先頭の範囲（PDF の仕様は先頭 1024 バイト以内に置けばよいとしている） */
export const PDF_SIGNATURE_WINDOW = 1024;

/** 実体の先頭のバイト列に PDF の見出しがあるか。Illustrator の「PDF 互換ファイル」は中身が PDF */
export function hasPdfSignature(head: Uint8Array): boolean {
  const needle = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const end = Math.min(head.length, PDF_SIGNATURE_WINDOW) - needle.length;
  for (let i = 0; i <= end; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (head[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

/** 実体の先頭を見て PDF 互換かを確かめる必要があるか（.ai だけ。ほかのファイルは追加で読まない） */
export function needsPdfSignatureCheck(fileName: string): boolean {
  return isIllustratorFile(fileName);
}

/**
 * 検証が済んだ実体の種類。.ai は PDF 互換と確かめられたときだけ PDF（紙面に出せる）、そうでなければ other（ダウンロードのみ）。
 * ファイル名は元の `.ai` のまま残す（形式の呼び名・ダウンロード名のため）。ほかのファイルは申告のまま
 */
export function resolveStoredType(
  item: { fileName: string; type: ArtifactType },
  pdfCompatible: boolean | undefined,
): ArtifactType {
  if (!isIllustratorFile(item.fileName)) return item.type;
  return pdfCompatible === true ? "pdf" : "other";
}
