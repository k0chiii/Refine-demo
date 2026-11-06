import { describe, expect, it } from "vite-plus/test";
import { igTruncate } from "./PostPreview";

describe("Instagram のキャプションの切り詰め（2 行）", () => {
  it("2 行に収まれば切らない", () => {
    expect(igTruncate("短い本文", 8)).toBeNull();
  });
  it("3 行目に入る改行で切る", () => {
    expect(igTruncate("1 行目\n2 行目\n3 行目", 8)).toBe("1 行目\n2 行目");
  });
  it("長い 1 段落は 2 行目の「… 続きを読む」の手前で切る", () => {
    const cut = igTruncate("あ".repeat(80), 8);
    expect(cut).toBe("あ".repeat(26 - 8 + 26 - 5));
  });
});
