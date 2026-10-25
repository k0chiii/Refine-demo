import { describe, expect, it } from "vite-plus/test";
import { isImeKeyEvent } from "./ime";

describe("isImeKeyEvent（日本語入力の確定のキー）", () => {
  it("変換中（Chrome・Android）と、変換を閉じたあとの確定（iPhone・Mac の Safari: keyCode 229）を拾う", () => {
    expect(isImeKeyEvent({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isImeKeyEvent({ isComposing: false, keyCode: 229 })).toBe(true);
  });
  it("ふつうの Enter は拾わない", () => {
    expect(isImeKeyEvent({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
