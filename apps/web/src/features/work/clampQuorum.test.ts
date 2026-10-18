import { describe, expect, it } from "vite-plus/test";
import { clampQuorum } from "./clampQuorum";

describe("clampQuorum（校了とみなす人数の入力）", () => {
  it("1..校了者の数に収める。空・読めない値は 1", () => {
    expect(clampQuorum("2", 3)).toBe(2);
    expect(clampQuorum("0", 3)).toBe(1);
    expect(clampQuorum("9", 3)).toBe(3);
    expect(clampQuorum("", 3)).toBe(1);
    expect(clampQuorum("abc", 3)).toBe(1);
    expect(clampQuorum("２", 3)).toBe(2);
    expect(clampQuorum(5, 2)).toBe(2);
    expect(clampQuorum("1", 0)).toBe(1);
  });
});
