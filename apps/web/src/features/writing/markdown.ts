import { flattenExtensions, generateHTML, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { documentExtensions } from "./extensions";

/**
 * Markdown の原稿（.md）を校正画面で読める形にする。
 * 原稿のファイル自体は提出されたまま（Markdown のまま）保存・ダウンロードされる。ここで作るのは表示用だけで、
 * 文章エディタと同じ構造（見出し・リスト・表・チェックリストなど）に読み込むので、範囲コメントも同じ仕組みで付けられる。
 * HTML を直接書いた部分は、この構造に無い要素・属性（script やイベント属性など）が落ちる。
 */
let manager: MarkdownManager | null = null;
function md(): MarkdownManager {
  manager ??= new MarkdownManager({
    extensions: flattenExtensions(documentExtensions({ editable: false })),
  });
  return manager;
}

export function markdownToJson(source: string): JSONContent {
  return md().parse(source);
}

export function markdownToHtml(source: string): string {
  return generateHTML(markdownToJson(source), documentExtensions({ editable: false }));
}

/** 文章エディタの内容を Markdown にする（書き出し用） */
export function jsonToMarkdown(doc: JSONContent): string {
  return md().serialize(doc);
}

/** Markdown の原稿か（拡張子か MIME で判定） */
export { isMarkdownArtifact } from "./plainText";
