import type { JSONContent } from "@tiptap/core";
import { Fragment, Slice, type Mark, type Node as PMNode } from "@tiptap/pm/model";

/**
 * Markdown に書き出すと消える書式（文字の色・ハイライトの色の種類・左以外の揃え・上付き/下付き）。
 * 文章エディタの編集で使える書式は Markdown で表せるものだけにする（利用者決定）。ただし既存の文章には入っていることがあり、
 * スキーマからは外さない（外すと読み込んだ時点で消えて保存で失われる）ので、表示は続け、原文に切り替えるときに知らせる。
 */
const unrepresentableMarks = new Set(["subscript", "superscript"]);

function markLoses(type: string, attrs: Record<string, unknown> | undefined): boolean {
  if (unrepresentableMarks.has(type)) return true;
  if (type === "textStyle") return Boolean(attrs?.color);
  if (type === "highlight") return Boolean(attrs?.color);
  return false;
}

function alignLoses(attrs: Record<string, unknown> | undefined): boolean {
  const a = attrs?.textAlign;
  return a === "center" || a === "right" || a === "justify";
}

/** 文章に、Markdown にすると消える書式が入っているか */
export function hasUnrepresentableFormatting(doc: JSONContent): boolean {
  if (alignLoses(doc.attrs)) return true;
  if (doc.marks?.some((m) => markLoses(m.type, m.attrs))) return true;
  return doc.content?.some(hasUnrepresentableFormatting) ?? false;
}

function keepMark(m: Mark): Mark | null {
  const type = m.type.name;
  if (type === "textStyle") return null;
  if (type === "highlight") return m.attrs.color ? m.type.create({ ...m.attrs, color: null }) : m;
  return unrepresentableMarks.has(type) ? null : m;
}

function strip(node: PMNode): PMNode {
  const content = node.content.size ? mapFragment(node.content) : node.content;
  const marks = node.marks.flatMap((m) => keepMark(m) ?? []);
  const marksSame =
    marks.length === node.marks.length && marks.every((m, i) => m === node.marks[i]);
  const align = !node.isText && alignLoses(node.attrs);
  if (content === node.content && marksSame && !align) return node;
  if (node.isText) return node.mark(marks);
  const attrs = align ? { ...node.attrs, textAlign: null } : node.attrs;
  return node.type.create(attrs, content, marksSame ? node.marks : marks);
}

function mapFragment(fragment: Fragment): Fragment {
  const nodes: PMNode[] = [];
  let changed = false;
  fragment.forEach((child) => {
    const next = strip(child);
    if (next !== child) changed = true;
    nodes.push(next);
  });
  return changed ? Fragment.fromArray(nodes) : fragment;
}

/**
 * ペーストで入ってくる、Markdown で表せない書式を落とす（editorProps.transformPasted に渡す）。
 * 色・ハイライトの色の種類・揃え・上付き/下付きを外し、ハイライトは色なしで残す。落とすものが無ければ同じ Slice を返す
 */
export function stripUnrepresentableFromSlice(slice: Slice): Slice {
  const content = mapFragment(slice.content);
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}
