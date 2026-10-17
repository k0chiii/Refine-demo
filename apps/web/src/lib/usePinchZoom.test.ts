import { describe, expect, it } from "vite-plus/test";
import { anchorShift, PINCH_MAX, PINCH_MIN, pinchScale } from "./usePinchZoom";

describe("ピンチの倍率", () => {
  it("指の間隔の比で倍率が変わり、上下限で止まる", () => {
    expect(pinchScale(1, 100, 200)).toBe(2);
    expect(pinchScale(2, 100, 50)).toBe(1);
    expect(pinchScale(1, 100, 10_000)).toBe(PINCH_MAX);
    expect(pinchScale(1, 100, 1)).toBe(PINCH_MIN);
    expect(pinchScale(1.5, 0, 50)).toBe(1.5);
  });
  it("拡大後も指の下の箇所が同じ画面位置に来るようにスクロールする量", () => {
    // 内容の左上が画面の 0、指は 100 の位置（内容の 100）。2 倍にすると内容の 200 が 100 に来るよう 100 進める
    expect(anchorShift(100, 2, 0, 100)).toBe(100);
    // 縮小（0.5 倍）なら 50 戻す
    expect(anchorShift(100, 0.5, 0, 100)).toBe(-50);
    // 指を動かしながら拡大したとき（中点が 100 → 160）は、その分だけ戻る
    expect(anchorShift(100, 2, 0, 160)).toBe(40);
  });
});
