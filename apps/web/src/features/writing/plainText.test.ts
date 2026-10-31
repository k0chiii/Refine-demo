import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vite-plus/test";
import { documentExtensions } from "./extensions";
import { buildPlainText, documentHtml, offsetToPos, posToOffset } from "./plainText";

const schema = getSchema(documentExtensions());
const doc = PMNode.fromJSON(schema, {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "題" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "太字", marks: [{ type: "bold" }] },
        { type: "text", text: "と本文" },
        { type: "hardBreak" },
        { type: "text", text: "改行後" },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "項目" }] }],
        },
      ],
    },
  ],
});

describe("本文 ⇔ 平文の対応（校正の範囲指摘・文字数・検索の基準）", () => {
  it("段落は改行で区切り、改行（hard break）も改行。書式は平文に影響しない", () => {
    expect(buildPlainText(doc).text).toBe("題\n太字と本文\n改行後\n項目");
  });
  it("オフセット → 位置 → オフセットが往復する（どの文字でも）", () => {
    const index = buildPlainText(doc);
    for (let i = 0; i <= index.text.length; i++) {
      if (index.text[i - 1] === "\n") continue; // 区切りの直後は次の文字の先頭に寄る
      const pos = offsetToPos(index, i, doc.content.size);
      expect(posToOffset(index, pos)).toBe(i);
    }
  });
  it("範囲の文字列は平文の部分文字列と一致する", () => {
    const index = buildPlainText(doc);
    const start = index.text.indexOf("と本文");
    const from = offsetToPos(index, start, doc.content.size);
    const to = offsetToPos(index, start + 3, doc.content.size);
    expect(doc.textBetween(from, to)).toBe("と本文");
  });
  it("提出用 HTML は制作物名をエスケープする", () => {
    expect(documentHtml("<a&b>", "<p>x</p>")).toContain("<title>&lt;a&amp;b&gt;</title>");
  });
});
