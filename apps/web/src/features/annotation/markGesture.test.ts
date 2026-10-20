import { describe, expect, it } from "vite-plus/test";
import {
  DRAG_SLOP,
  MOUSE_HOLD_MS,
  POINT_MAX,
  TOUCH_HOLD_MS,
  TOUCH_SLOP,
  holdMs,
  kindOf,
  moveOutcome,
  shapeOf,
} from "./markGesture";

describe("markGesture", () => {
  it("ペンはマウスと同じ、タッチだけ別に扱う", () => {
    expect(kindOf("touch")).toBe("touch");
    expect(kindOf("mouse")).toBe("mouse");
    expect(kindOf("pen")).toBe("mouse");
  });

  it("長押しの時間は、タッチのほうが短い", () => {
    expect(holdMs("touch")).toBe(TOUCH_HOLD_MS);
    expect(holdMs("mouse")).toBe(MOUSE_HOLD_MS);
    expect(TOUCH_HOLD_MS).toBeLessThan(MOUSE_HOLD_MS);
  });

  it("マウスは少し動かすまではクリック、超えたらドラッグ", () => {
    expect(moveOutcome("mouse", false, 0)).toBe("wait");
    expect(moveOutcome("mouse", false, DRAG_SLOP)).toBe("wait");
    expect(moveOutcome("mouse", false, DRAG_SLOP + 1)).toBe("drag");
  });

  it("タッチは長押しの前に動いたらスクロール、長押しの後は範囲", () => {
    expect(moveOutcome("touch", false, TOUCH_SLOP)).toBe("wait");
    expect(moveOutcome("touch", false, TOUCH_SLOP + 1)).toBe("scroll");
    expect(moveOutcome("touch", true, 200)).toBe("drag");
  });

  it("長押しが済んでいれば、マウスも動かしたら範囲", () => {
    expect(moveOutcome("mouse", true, 1)).toBe("drag");
  });

  it("小さい範囲はピン、片方でも大きければ範囲", () => {
    expect(shapeOf(0, 0)).toBe("point");
    expect(shapeOf(POINT_MAX - 1, POINT_MAX - 1)).toBe("point");
    expect(shapeOf(POINT_MAX, 0)).toBe("rect");
    expect(shapeOf(0, POINT_MAX)).toBe("rect");
  });
});
