import type { Extensions } from "@tiptap/core";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { StarterKit } from "@tiptap/starter-kit";

/**
 * 文章エディタと、提出された文章の閲覧（校正画面）で共有するスキーマ。
 * 両者が同じ拡張で HTML を読むので、提出した HTML に未知の要素・属性（script やイベント属性）が入っていても
 * スキーマに無いものは読み込まれない（表示時の無害化を兼ねる）。
 *
 * Google ドキュメントの段落スタイルのうち「タイトル」「サブタイトル」「見出し 4〜6」は持たない（見出し 1〜3 で足りる。docs/EDITOR_RESEARCH.md）。
 */
export function documentExtensions(
  opts: { placeholder?: string; editable?: boolean } = {},
): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
      code: false,
      link: {
        openOnClick: !opts.editable,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({
      types: ["heading", "paragraph"],
      alignments: ["left", "center", "right", "justify"],
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Subscript,
    Superscript,
    ...(opts.placeholder ? [Placeholder.configure({ placeholder: opts.placeholder })] : []),
  ];
}

/** 段落スタイル（Google ドキュメントの「標準テキスト / 見出し」）。文字の大きさは M3 のタイプスケールに対応させる */
export const paragraphStyles = [
  { id: "p", label: "標準テキスト", level: 0, shortcut: "Ctrl+Alt+0", type: "body-large" },
  { id: "h1", label: "見出し 1", level: 1, shortcut: "Ctrl+Alt+1", type: "headline-medium" },
  { id: "h2", label: "見出し 2", level: 2, shortcut: "Ctrl+Alt+2", type: "headline-small" },
  { id: "h3", label: "見出し 3", level: 3, shortcut: "Ctrl+Alt+3", type: "title-large" },
] as const;
export type ParagraphStyleId = (typeof paragraphStyles)[number]["id"];

/** 文字色・ハイライトの見本（印刷・書き出しでも同じ色になるよう固定値）。null は「なし／既定」 */
export const textColors: Array<{ label: string; value: string | null }> = [
  { label: "既定（黒）", value: null },
  { label: "グレー", value: "#5f6368" },
  { label: "赤", value: "#c5221f" },
  { label: "オレンジ", value: "#b06000" },
  { label: "緑", value: "#137333" },
  { label: "青", value: "#1a73e8" },
  { label: "紫", value: "#8430ce" },
];
export const highlightColors: Array<{ label: string; value: string | null }> = [
  { label: "なし", value: null },
  { label: "黄", value: "#fef7c3" },
  { label: "緑", value: "#ceead6" },
  { label: "青", value: "#d2e3fc" },
  { label: "ピンク", value: "#fad2cf" },
  { label: "紫", value: "#e9d2fd" },
];
