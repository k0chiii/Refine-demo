import { describe, expect, it } from "vite-plus/test";
import {
  formatVideoSpan,
  formatVideoTime,
  fromViewportRect,
  TEXT_QUOTE_MAX,
  textRangeAnchor,
  toViewportRect,
  validateAnchor,
  VIDEO_TIME_MAX,
  videoTimeAnchor,
  type Anchor,
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

  it("F-12: text_range は [start, end) の文字オフセットと引用文を持ち、空範囲・長すぎる引用は拒否", () => {
    const text = "五月祭常任委員会のパンフレット。表紙の配色を確認してください。";
    const a = textRangeAnchor("art1", text, 0, 8);
    expect(a).toEqual({
      type: "text_range",
      artifactId: "art1",
      start: 0,
      end: 8,
      quote: "五月祭常任委員会",
    });
    expect(() => validateAnchor(a)).not.toThrow();
    expect(() => validateAnchor({ ...a, end: 0 })).toThrow(
      expect.objectContaining({ code: "anchor_invalid" }),
    );
    expect(() => validateAnchor({ ...a, start: -1 })).toThrow(
      expect.objectContaining({ code: "anchor_invalid" }),
    );
    expect(() => validateAnchor({ ...a, quote: "x".repeat(TEXT_QUOTE_MAX + 1) })).toThrow(
      expect.objectContaining({ code: "anchor_invalid" }),
    );
    // 範囲外はスナップショット長に丸める
    expect(textRangeAnchor("art1", text, 100, 200)).toMatchObject({
      start: text.length,
      end: text.length,
      quote: "",
    });
  });
});

describe("動画の位置（時点・範囲・画面の上）", () => {
  const ok = (a: Anchor) => expect(() => validateAnchor(a)).not.toThrow();
  const bad = (a: Anchor) =>
    expect(() => validateAnchor(a)).toThrow(expect.objectContaining({ code: "anchor_invalid" }));
  const v = (x: Partial<Extract<Anchor, { type: "video_time" }>>): Anchor => ({
    type: "video_time",
    artifactId: "a1",
    start: 3,
    ...x,
  });

  it("時点・範囲・画面の矩形かピンを持てる", () => {
    ok(v({}));
    ok(v({ start: 0 }));
    ok(v({ end: 6.5 }));
    ok(v({ end: 6.5, rect }));
    ok(v({ point: { x: 0.5, y: 0.5 } }));
  });

  it("負の時刻・長すぎる時刻・終わりが始まり以前・矩形とピンの両方・はみ出す矩形は拒否", () => {
    bad(v({ start: -1 }));
    bad(v({ start: Number.NaN }));
    bad(v({ start: VIDEO_TIME_MAX + 1 }));
    bad(v({ end: 3 }));
    bad(v({ end: 2 }));
    bad(v({ rect, point: { x: 0.1, y: 0.1 } }));
    bad(v({ rect: { x: 0.9, y: 0, w: 0.2, h: 0.1 } }));
    bad(v({ point: { x: 1.2, y: 0 } }));
  });

  it("作るときはミリ秒に丸め、終わりが始まり以前なら時点。矩形があればピンは付けない", () => {
    expect(videoTimeAnchor("a1", { start: 1.23456, end: 4.56789 })).toEqual({
      type: "video_time",
      artifactId: "a1",
      start: 1.235,
      end: 4.568,
    });
    expect(videoTimeAnchor("a1", { start: 4, end: 4 })).toEqual({
      type: "video_time",
      artifactId: "a1",
      start: 4,
    });
    expect(videoTimeAnchor("a1", { start: -0.2 }, { rect, point: { x: 0.1, y: 0.1 } })).toEqual({
      type: "video_time",
      artifactId: "a1",
      start: 0,
      rect,
    });
  });

  it("時刻の表示は m:ss（1 時間以上は h:mm:ss）、細かくは 1/100 秒まで。範囲は「–」でつなぐ", () => {
    expect(formatVideoTime(0)).toBe("0:00");
    expect(formatVideoTime(3.999)).toBe("0:03");
    expect(formatVideoTime(65)).toBe("1:05");
    expect(formatVideoTime(3725)).toBe("1:02:05");
    expect(formatVideoTime(3.5, true)).toBe("0:03.50");
    expect(formatVideoTime(12.007, true)).toBe("0:12.00");
    expect(formatVideoSpan({ start: 3 })).toBe("0:03");
    expect(formatVideoSpan({ start: 3, end: 6.4 })).toBe("0:03–0:06");
  });
});
