import { describe, expect, it } from "vite-plus/test";
import { centeredPaneWidth } from "./PaneHandle";

describe("ペインのスナップ幅", () => {
  it("スペーサーの中心が窓の中心に来る幅（窓の半分 − 12 − 末尾の余白 24）", () => {
    expect(centeredPaneWidth(1440)).toBe(684);
    expect(centeredPaneWidth(1024)).toBe(476);
  });
});
