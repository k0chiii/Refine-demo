import { DomainError } from "@mf100/domain";

/**
 * 共同編集の本文（ProseMirror の JSON）から、エディタと同じ規則の平文を取る。段落・見出し・コードブロックの前と hardBreak で改行。
 * apps/convex/convex/collaboration.ts の documentText の写し。Convex は素の Error で落とすが、ここは DomainError（400 で返る）
 */
export function documentText(content: string): string {
  if (content.length > 2_000_000) throw new DomainError("document_too_large");
  const invalid = () => new DomainError("document_invalid");
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    throw invalid();
  }
  let text = "",
    count = 0,
    first = true;
  function walk(value: unknown, depth = 0) {
    // 深さと個数を縛るのは、悪意のある巨大な木で DO を止めないため
    if (++count > 50_000 || depth > 100 || !value || typeof value !== "object") throw invalid();
    const node = value as { type?: unknown; text?: unknown; content?: unknown };
    if (typeof node.type !== "string") throw invalid();
    if (["paragraph", "heading", "codeBlock"].includes(node.type)) {
      if (!first) text += "\n";
      first = false;
    }
    if (node.type === "text") {
      if (typeof node.text !== "string") throw invalid();
      text += node.text;
    }
    if (node.type === "hardBreak") text += "\n";
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw invalid();
      for (const child of node.content) walk(child, depth + 1);
    }
  }
  if (!root || typeof root !== "object" || (root as { type?: unknown }).type !== "doc")
    throw invalid();
  walk(root);
  return text;
}
