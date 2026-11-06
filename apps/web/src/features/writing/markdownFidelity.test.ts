import { getSchema, type JSONContent } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { describe, expect, it } from "vite-plus/test";
import { documentExtensions } from "./extensions";
import { jsonToMarkdown, markdownToJson } from "./markdown";
import { hasUnrepresentableFormatting, stripUnrepresentableFromSlice } from "./markdownFidelity";

const para = (content: JSONContent[], attrs?: Record<string, unknown>): JSONContent => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content,
});
const text = (
  t: string,
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>,
): JSONContent => ({
  type: "text",
  text: t,
  ...(marks ? { marks } : {}),
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

describe("Markdown で表せない書式の判定", () => {
  it("Markdown で往復できる書式だけなら false", () => {
    const d = doc(
      { type: "heading", attrs: { level: 1 }, content: [text("見出し")] },
      para([
        text("太", [{ type: "bold" }]),
        text("斜", [{ type: "italic" }]),
        text("線", [{ type: "underline" }]),
        text("消", [{ type: "strike" }]),
        text("光", [{ type: "highlight" }]),
        text("リンク", [{ type: "link", attrs: { href: "https://example.com" } }]),
      ]),
      para([text("左")], { textAlign: "left" }),
      para([text("色なしの textStyle")], undefined),
    );
    expect(hasUnrepresentableFormatting(d)).toBe(false);
  });
  it("文字の色があれば true（入れ子のリストの中でも）", () => {
    const d = doc({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [para([text("赤", [{ type: "textStyle", attrs: { color: "#c5221f" } }])])],
        },
      ],
    });
    expect(hasUnrepresentableFormatting(d)).toBe(true);
  });
  it("色の付かない textStyle は問題にしない", () => {
    expect(
      hasUnrepresentableFormatting(
        doc(para([text("a", [{ type: "textStyle", attrs: { color: null } }])])),
      ),
    ).toBe(false);
  });
  it("ハイライトの色の種類があれば true、色なしなら false", () => {
    expect(
      hasUnrepresentableFormatting(
        doc(para([text("黄", [{ type: "highlight", attrs: { color: "#fef7c3" } }])])),
      ),
    ).toBe(true);
    expect(hasUnrepresentableFormatting(doc(para([text("光", [{ type: "highlight" }])])))).toBe(
      false,
    );
    expect(
      hasUnrepresentableFormatting(
        doc(para([text("光", [{ type: "highlight", attrs: { color: null } }])])),
      ),
    ).toBe(false);
  });
  it("上付き・下付きがあれば true", () => {
    expect(hasUnrepresentableFormatting(doc(para([text("2", [{ type: "superscript" }])])))).toBe(
      true,
    );
    expect(hasUnrepresentableFormatting(doc(para([text("2", [{ type: "subscript" }])])))).toBe(
      true,
    );
  });
  it("左以外の揃えがあれば true（見出しでも表のセルの中でも）", () => {
    for (const a of ["center", "right", "justify"]) {
      expect(hasUnrepresentableFormatting(doc(para([text("x")], { textAlign: a })))).toBe(true);
    }
    expect(
      hasUnrepresentableFormatting(
        doc({ type: "heading", attrs: { level: 2, textAlign: "center" }, content: [text("x")] }),
      ),
    ).toBe(true);
  });
  it("空の文章は false", () => {
    expect(hasUnrepresentableFormatting({ type: "doc" })).toBe(false);
  });
  it("判定が true の文章は、実際に Markdown を経由すると書式が落ちる（判定の根拠）", () => {
    const d = doc(para([text("赤", [{ type: "textStyle", attrs: { color: "#c5221f" } }])]));
    expect(JSON.stringify(markdownToJson(jsonToMarkdown(d)))).not.toContain("textStyle");
  });
});

describe("ペーストで入ってくる Markdown で表せない書式を落とす", () => {
  const schema = getSchema(documentExtensions());
  const sliceOf = (d: JSONContent, open = 0): Slice =>
    new Slice(schema.nodeFromJSON(d).content, open, open);
  const json = (slice: Slice): string => JSON.stringify(slice.content.toJSON());

  it("文字の色・上付き・下付き・揃えを落とし、太字などは残す", () => {
    const slice = sliceOf(
      doc(
        para(
          [
            text("赤い太字", [
              { type: "textStyle", attrs: { color: "#c5221f" } },
              { type: "bold" },
            ]),
            text("上", [{ type: "superscript" }]),
            text("下", [{ type: "subscript" }]),
          ],
          { textAlign: "center" },
        ),
      ),
    );
    expect(json(slice)).toContain("#c5221f");
    const after = json(stripUnrepresentableFromSlice(slice));
    expect(after).not.toContain("textStyle");
    expect(after).not.toContain("#c5221f");
    expect(after).not.toContain("center");
    expect(after).not.toContain("superscript");
    expect(after).not.toContain("subscript");
    expect(after).toContain('"bold"');
    expect(after).toContain("赤い太字");
    expect(after).toContain("上");
    expect(after).toContain("下");
  });
  it("ハイライトは色だけを落とし、ハイライト自体は残す", () => {
    const after = json(
      stripUnrepresentableFromSlice(
        sliceOf(doc(para([text("黄", [{ type: "highlight", attrs: { color: "#fef7c3" } }])]))),
      ),
    );
    expect(after).toContain('"highlight"');
    expect(after).not.toContain("fef7c3");
  });
  it("リストや見出しの中の書式も落とす。Slice の開き具合（openStart/openEnd）は保つ", () => {
    const slice = sliceOf(
      doc(
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                para([text("青", [{ type: "textStyle", attrs: { color: "#1a73e8" } }])], {
                  textAlign: "right",
                }),
              ],
            },
          ],
        },
        { type: "heading", attrs: { level: 2, textAlign: "justify" }, content: [text("h")] },
      ),
      1,
    );
    const out = stripUnrepresentableFromSlice(slice);
    const after = json(out);
    expect(after).not.toContain("#1a73e8");
    expect(after).not.toContain("right");
    expect(after).not.toContain("justify");
    expect(after).toContain('"level":2');
    expect(out.openStart).toBe(1);
    expect(out.openEnd).toBe(1);
  });
  it("落とすものが無ければ同じ Slice を返す", () => {
    const slice = sliceOf(doc(para([text("a", [{ type: "bold" }])], { textAlign: "left" })));
    expect(stripUnrepresentableFromSlice(slice)).toBe(slice);
    const empty = new Slice(Fragment.empty, 0, 0);
    expect(stripUnrepresentableFromSlice(empty)).toBe(empty);
  });
});
