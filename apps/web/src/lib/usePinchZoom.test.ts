import { describe, expect, it } from "vite-plus/test";
import { PINCH_MAX, PINCH_MIN, pinchScale } from "./usePinchZoom";

describe("pinchScale", () => {
  it("指の間隔の比で倍率を変える", () => {
    expect(pinchScale(1, 100, 200)).toBe(2);
    expect(pinchScale(2, 200, 100)).toBe(1);
  });
  it("上下限を超えない", () => {
    expect(pinchScale(1, 100, 10_000)).toBe(PINCH_MAX);
    expect(pinchScale(1, 100, 1)).toBe(PINCH_MIN);
  });
  it("最初の間隔が 0 なら変えない", () => {
    expect(pinchScale(1.5, 0, 100)).toBe(1.5);
  });
});
