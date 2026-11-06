import { describe, expect, it } from "vite-plus/test";
import { isKeyboardOpen, keyboardInset } from "./useKeyboardInset";

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

describe("isKeyboardOpen（iPhone のホーム画面アプリはレイアウトの高さも縮む）", () => {
  const base = { baselineHeight: 844, layoutHeight: 844, visualTop: 0 };
  it("レイアウトと見えている高さが一緒に縮んでも、いつもの高さより低ければ出ている", () => {
    expect(isKeyboardOpen({ ...base, editing: true, visualHeight: 480, layoutHeight: 480 })).toBe(
      true,
    );
  });
  it("入力中でなければ出ていない（ブラウザのツールバーの出入りなど）", () => {
    expect(isKeyboardOpen({ ...base, editing: false, visualHeight: 480 })).toBe(false);
  });
  it("差が小さいときは出ていない（外付けキーボードの候補バーなど）", () => {
    expect(isKeyboardOpen({ ...base, editing: true, visualHeight: 800 })).toBe(false);
  });
});
