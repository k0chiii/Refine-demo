import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * 文書（ProseMirror の doc）と平文の対応表。
 * 平文は「段落（テキストブロック）ごとに改行で区切り、改行（hard break）も改行」にする。
 * 校正画面の範囲指摘（text_range の文字オフセット）・文字カウント・検索と置換・提出時の平文はすべてこれを使うので、
 * 同じ文書からは必ず同じ平文とオフセットが得られる。
 */
export interface PlainTextIndex {
  text: string;
  /** 平文の区間 [textStart, textStart+length) ↔ 文書位置 [pos, pos+length) */
  spans: Array<{ textStart: number; pos: number; length: number }>;
}

export function buildPlainText(doc: PMNode): PlainTextIndex {
  let text = "";
  const spans: PlainTextIndex["spans"] = [];
  let first = true;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!first) text += "\n";
      first = false;
      return true;
    }
    if (node.isText) {
      spans.push({ textStart: text.length, pos, length: node.text!.length });
      text += node.text!;
      return false;
    }
    if (node.type.name === "hardBreak") {
      text += "\n";
      return false;
    }
    return true;
  });
  return { text, spans };
}

/** 平文のオフセット → 文書位置。区間の外（段落の区切り）は次の文字の位置に寄せる */
export function offsetToPos(index: PlainTextIndex, offset: number, docSize: number): number {
  for (const s of index.spans) {
    if (offset < s.textStart) return s.pos;
    if (offset <= s.textStart + s.length) return s.pos + (offset - s.textStart);
  }
  const last = index.spans.at(-1);
  return last ? last.pos + last.length : Math.min(1, docSize);
}

/** 文書位置 → 平文のオフセット。テキストの外（ブロックの境目）は直後のテキストの先頭に寄せる */
export function posToOffset(index: PlainTextIndex, pos: number): number {
  for (const s of index.spans) {
    if (pos < s.pos) return s.textStart;
    if (pos <= s.pos + s.length) return s.textStart + (pos - s.pos);
  }
  return index.text.length;
}

/** 提出用の HTML（版スナップショット）。本文以外は持たない */
export function documentHtml(title: string, bodyHtml: string): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n</head>\n<body>\n${bodyHtml}\n</body>\n</html>\n`;
}

/** 提出された HTML から本文を取り出す（DOMParser はスクリプトを実行しない。読み込みはスキーマで無害化される） */
export function bodyOfHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return parsed.body.innerHTML;
}

export function isHtmlArtifact(a: { mimeType?: string; fileName: string }): boolean {
  return a.mimeType === "text/html" || /\.html?$/i.test(a.fileName);
}
