import { describe, expect, it } from "vite-plus/test";
import { keyboardInset } from "./useKeyboardInset";

describe("keyboardInset", () => {
  it("キーボードが出ていなければ 0", () => {
    expect(keyboardInset(844, 844, 0)).toBe(0);
  });
  it("ブラウザのツールバーの出入り程度の差は拾わない", () => {
    expect(keyboardInset(844, 780, 0)).toBe(0);
  });
  it("見えている範囲が縮んだ分をキーボードの高さとする", () => {
    expect(keyboardInset(844, 508, 0)).toBe(336);
  });
  it("ページがずれて見えている（offsetTop）分は差し引く", () => {
    expect(keyboardInset(844, 508, 40)).toBe(296);
  });
});
