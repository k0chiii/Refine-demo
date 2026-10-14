import { describe, expect, it } from "vite-plus/test";
import {
  countText,
  DOCUMENT_LIMITS,
  isDocumentContent,
  nextDraft,
  type DocumentDraft,
} from "../document/DocumentDraft.ts";

const doc = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
const base: DocumentDraft = {
  id: "d1",
  workId: "w1",
  title: "あいさつ文",
  content: doc,
  text: "",
  version: 3,
  updatedBy: "u1",
  updatedAt: 1,
};
const code = (c: string) => expect.objectContaining({ code: c });

describe("文章の下書き（楽観的排他）", () => {
  it("新規は baseVersion 0 で版 1 になる", () => {
    const next = nextDraft(
      null,
      { title: " 題 ", content: doc, text: "", baseVersion: 0 },
      "u1",
      5,
      "w1",
    );
    expect(next).toMatchObject({
      workId: "w1",
      title: "題",
      version: 1,
      updatedBy: "u1",
      updatedAt: 5,
    });
  });
  it("版番号が一致すれば +1、食い違えば version_conflict（他の人の保存を上書きしない）", () => {
    expect(
      nextDraft(base, { title: "t", content: doc, text: "", baseVersion: 3 }, "u2", 9, "w1")
        .version,
    ).toBe(4);
    expect(() =>
      nextDraft(base, { title: "t", content: doc, text: "", baseVersion: 2 }, "u2", 9, "w1"),
    ).toThrow(code("version_conflict"));
    expect(() =>
      nextDraft(null, { title: "t", content: doc, text: "", baseVersion: 1 }, "u2", 9, "w1"),
    ).toThrow(code("version_conflict"));
  });
  it("壊れた本文・大きすぎる本文・長すぎる題名は document_invalid", () => {
    const bad = (patch: Partial<{ title: string; content: string; text: string }>) => () =>
      nextDraft(
        base,
        { title: "t", content: doc, text: "", baseVersion: 3, ...patch },
        "u1",
        1,
        "w1",
      );
    expect(bad({ content: "{" })).toThrow(code("document_invalid"));
    expect(bad({ content: JSON.stringify({ type: "paragraph" }) })).toThrow(
      code("document_invalid"),
    );
    expect(bad({ title: "あ".repeat(DOCUMENT_LIMITS.titleChars + 1) })).toThrow(
      code("document_invalid"),
    );
    expect(bad({ text: "a".repeat(DOCUMENT_LIMITS.textChars + 1) })).toThrow(
      code("document_invalid"),
    );
    expect(
      bad({
        content: JSON.stringify({
          type: "doc",
          content: [],
          pad: "x".repeat(DOCUMENT_LIMITS.contentBytes),
        }),
      }),
    ).toThrow(code("document_invalid"));
  });
  it("isDocumentContent は doc 型の JSON だけを受け付ける", () => {
    expect(isDocumentContent(doc)).toBe(true);
    expect(isDocumentContent(JSON.stringify({ type: "doc" }))).toBe(true);
    expect(isDocumentContent("null")).toBe(false);
    expect(isDocumentContent("[]")).toBe(false);
  });
});

describe("文字カウント（Google ドキュメントの数え方に合わせる）", () => {
  it("英単語はまとまりで 1 語、かな・漢字は 1 文字 1 語。改行は文字数に入れない", () => {
    expect(countText("Hello world\n五月祭")).toEqual({
      words: 5,
      characters: 14,
      charactersNoSpaces: 13,
    });
  });
  it("空文字は 0", () => {
    expect(countText("")).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0 });
  });
});
