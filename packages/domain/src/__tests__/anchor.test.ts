import { describe, expect, it } from "vite-plus/test";
import {
  fromViewportRect,
  toViewportRect,
  validateAnchor,
  type Viewport,
} from "../comment/Anchor.ts";

const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };

describe("Anchor 座標変換（A-03: 倍率・回転に依存しない）", () => {
  const cases: Viewport[] = [
    { width: 600, height: 800, rotation: 0 },
    { width: 1200, height: 1600, rotation: 0 },
    { width: 800, height: 600, rotation: 90 },
    { width: 600, height: 800, rotation: 180 },
    { width: 1600, height: 1200, rotation: 270 },
  ];
  for (const vp of cases) {
    it(`往復変換で元の正規化矩形に戻る (${vp.width}x${vp.height} rot=${vp.rotation})`, () => {
      const px = toViewportRect(rect, vp);
      const back = fromViewportRect(px, vp);
      expect(back.x).toBeCloseTo(rect.x, 9);
      expect(back.y).toBeCloseTo(rect.y, 9);
      expect(back.w).toBeCloseTo(rect.w, 9);
      expect(back.h).toBeCloseTo(rect.h, 9);
    });
  }
  it("倍率が変わってもピクセル矩形は比例する", () => {
    const a = toViewportRect(rect, { width: 600, height: 800, rotation: 0 });
    const b = toViewportRect(rect, { width: 1200, height: 1600, rotation: 0 });
    expect(b.x / a.x).toBeCloseTo(2);
    expect(b.w / a.w).toBeCloseTo(2);
  });
  it("90度回転で左上の矩形が右上へ移る", () => {
    const px = toViewportRect(
      { x: 0, y: 0, w: 0.1, h: 0.1 },
      { width: 800, height: 600, rotation: 90 },
    );
    expect(px.x).toBeCloseTo(720);
    expect(px.y).toBeCloseTo(0);
  });
});

describe("validateAnchor", () => {
  it("範囲外の矩形は拒否する", () => {
    expect(() =>
      validateAnchor({
        type: "pdf_rect",
        artifactId: "a",
        page: 1,
        rect: { x: 0.9, y: 0, w: 0.5, h: 0.1 },
      }),
    ).toThrow();
    expect(() => validateAnchor({ type: "pdf_rect", artifactId: "a", page: 0, rect })).toThrow();
    expect(() =>
      validateAnchor({ type: "image_pin", artifactId: "a", point: { x: 1.2, y: 0 } }),
    ).toThrow();
  });
  it("正常なアンカーは通る", () => {
    expect(() =>
      validateAnchor({ type: "pdf_rect", artifactId: "a", page: 1, rect }),
    ).not.toThrow();
    expect(() => validateAnchor({ type: "image_rect", artifactId: "a", rect })).not.toThrow();
  });
});
