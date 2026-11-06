import { describe, expect, it } from "vite-plus/test";
import { buildTextSegments, segmentOffset, tokenize } from "./postText";

describe("本文のプレビューの区切り", () => {
  const text = "開催！ #五月祭 https://example.invalid/long/path をご覧ください";
  const tag = { start: 4, end: 9, kind: "tag" as const };
  const url = { start: 10, end: 40, kind: "url" as const, atomic: true };

  it("色分けの区切りと、その間の plain に分ける（全体を欠けも重ねもなく覆う）", () => {
    const toks = tokenize(text.length, [url, tag]);
    expect(toks.map((t) => t.kind)).toEqual(["plain", "tag", "plain", "url", "plain"]);
    expect(toks[0]!.start).toBe(0);
    expect(toks.at(-1)!.end).toBe(text.length);
    for (let i = 1; i < toks.length; i++) expect(toks[i]!.start).toBe(toks[i - 1]!.end);
  });

  it("コメントの範囲の境目で分け、重なりは複数のコメントを持つ", () => {
    const toks = tokenize(text.length, [tag]);
    const segs = buildTextSegments(
      text.length,
      toks,
      [
        { id: "a", start: 2, end: 6 },
        { id: "b", start: 5, end: 9 },
      ],
      null,
    );
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
      [5, 6],
      [6, 9],
      [9, text.length],
    ]);
    expect(segs.find((s) => s.start === 5)!.marks.map((m) => m.id)).toEqual(["a", "b"]);
    expect(segs.find((s) => s.start === 0)!.marks).toEqual([]);
    // 区切りの種類（タグ）はそのまま
    expect(segs.find((s) => s.start === 4)!.kind).toBe("tag");
  });

  it("省略して見せる URL は途中で分けず、一部が重なればまるごと強調する", () => {
    const toks = tokenize(text.length, [url]);
    const segs = buildTextSegments(text.length, toks, [{ id: "a", start: 20, end: 25 }], {
      start: 0,
      end: 2,
    });
    const u = segs.filter((s) => s.kind === "url");
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ start: 10, end: 40, atomic: true });
    expect(u[0]!.marks.map((m) => m.id)).toEqual(["a"]);
    expect(segs[0]!.draft).toBe(true);
  });

  it("「続きを読む」の手前で切った本文では、見えている分だけを覆う", () => {
    const toks = tokenize(12, [tag]);
    const segs = buildTextSegments(12, toks, [{ id: "a", start: 8, end: 30 }], null);
    expect(segs.at(-1)!.end).toBe(12);
    expect(segs.some((s) => s.marks.length > 0 && s.start >= 8)).toBe(true);
  });

  it("画面の中の位置 → 本文のオフセット", () => {
    expect(segmentOffset({ start: 10, end: 20, atomic: false }, 3, "start")).toBe(13);
    expect(segmentOffset({ start: 10, end: 20, atomic: false }, 99, "end")).toBe(20);
    // 省略した URL: 始点は頭、終点は終わりへ寄せる
    expect(segmentOffset({ start: 10, end: 40, atomic: true }, 5, "start")).toBe(10);
    expect(segmentOffset({ start: 10, end: 40, atomic: true }, 5, "end")).toBe(40);
  });
});
