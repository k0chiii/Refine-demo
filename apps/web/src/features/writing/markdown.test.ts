import { describe, expect, it } from "vite-plus/test";
import { isMarkdownArtifact, jsonToMarkdown, markdownToJson } from "./markdown";

describe("Markdown の原稿", () => {
  it("見出し・強調・リストを文章エディタと同じ構造に読む", () => {
    const doc = markdownToJson("# 第100回五月祭\n\n**入場無料**です。\n\n- 日程\n- 会場\n");
    const types = (doc.content ?? []).map((n) => n.type);
    expect(types).toEqual(["heading", "paragraph", "bulletList"]);
    expect(doc.content?.[0]?.attrs?.level).toBe(1);
    expect(JSON.stringify(doc.content?.[1])).toContain("bold");
  });
  it("書き出すと Markdown に戻る", () => {
    const back = jsonToMarkdown(markdownToJson("# 見出し\n\n本文です。"));
    expect(back).toContain("# 見出し");
    expect(back).toContain("本文です。");
  });
  it("拡張子か MIME で判定する", () => {
    expect(isMarkdownArtifact({ fileName: "a.md" })).toBe(true);
    expect(isMarkdownArtifact({ fileName: "a.txt", mimeType: "text/markdown" })).toBe(true);
    expect(isMarkdownArtifact({ fileName: "a.html", mimeType: "text/html" })).toBe(false);
  });
});
