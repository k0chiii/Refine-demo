import { describe, expect, it } from "vite-plus/test";
import { nextStacked } from "./stacked";

describe("nextStacked", () => {
  it("重なったコメントを順に選ぶ（最後の次は先頭）", () => {
    expect(nextStacked(["a", "b", "c"], null)).toBe("a");
    expect(nextStacked(["a", "b", "c"], "a")).toBe("b");
    expect(nextStacked(["a", "b", "c"], "c")).toBe("a");
    expect(nextStacked(["a", "b"], "x")).toBe("a");
    expect(nextStacked([], "a")).toBeNull();
  });
});
