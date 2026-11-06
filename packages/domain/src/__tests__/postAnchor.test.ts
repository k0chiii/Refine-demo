import { describe, expect, it } from "vite-plus/test";
import {
  anchorFitsArtifact,
  locateTextRange,
  normalizePostTextRange,
  pointFromCrop,
  pointToCrop,
  POST_BODY_NAME,
  POST_IMAGE_RECT_MIN,
  POST_MANIFEST_NAME,
  postBodyArtifact,
  postImageAnchor,
  postImageArtifacts,
  postImageIndex,
  postTargetLabel,
  postTextAnchor,
  rectFromCrop,
  rectToCrop,
  resolvePostAnchor,
  TEXT_QUOTE_MAX,
  validateAnchor,
  cropRect,
  type Anchor,
  type SocialPost,
} from "../index.ts";

const body =
  "第100回五月祭を開催します！\n詳しくは https://example.invalid をご覧ください。\n#五月祭 🎉🎉";
const art = (id: string, fileName: string, type = "other") => ({
  id,
  fileName,
  type,
  role: "source",
});
const artifacts = [
  art("b", POST_BODY_NAME, "document"),
  art("i1", "01-poster.png", "image"),
  art("i2", "02-sample.png", "image"),
  art("m", POST_MANIFEST_NAME),
];
const post: Pick<SocialPost, "body" | "images"> = {
  body,
  images: [
    { key: "k1", fileName: "01-poster.png", alt: "", aspect: "1:1" },
    { key: "k2", fileName: "02-sample.png", alt: "", aspect: "4:5" },
  ],
};

describe("SNS の本文の範囲（text_range）", () => {
  it("選択を整える: 先頭・末尾の空白と改行は含めない。空なら null", () => {
    const s = body.indexOf("詳しく");
    expect(normalizePostTextRange(body, s - 1, s + 4)).toEqual({ start: s, end: s + 4 });
    expect(normalizePostTextRange(body, 3, 3)).toBeNull();
    const nl = body.indexOf("\n");
    expect(normalizePostTextRange(body, nl, nl + 1)).toBeNull();
    // 逆向きの選択・範囲外は本文に収める
    expect(normalizePostTextRange(body, 5, 0)).toEqual({ start: 0, end: 5 });
    expect(normalizePostTextRange(body, -10, 4)).toEqual({ start: 0, end: 4 });
    expect(normalizePostTextRange(body, 0, 99999)?.end).toBe(body.length);
    expect(normalizePostTextRange(body, Number.NaN, 3)).toBeNull();
  });

  it("絵文字（サロゲートペア）の途中では切らず、外へ広げる", () => {
    const e = body.indexOf("🎉");
    expect(normalizePostTextRange(body, e + 1, e + 4)).toEqual({ start: e, end: e + 4 });
    expect(normalizePostTextRange(body, e - 2, e + 1)).toEqual({ start: e - 2, end: e + 2 });
  });

  it("アンカーを作る: 本文の添付・オフセット・引用文。検証を通る", () => {
    const s = body.indexOf("五月祭");
    const a = postTextAnchor("b", body, s, s + 3)!;
    expect(a).toEqual({
      type: "text_range",
      artifactId: "b",
      start: s,
      end: s + 3,
      quote: "五月祭",
    });
    expect(() => validateAnchor(a)).not.toThrow();
    expect(postTextAnchor("b", body, 4, 4)).toBeNull();
  });

  it("引用文は TEXT_QUOTE_MAX 文字まで。範囲そのものは切らない", () => {
    const long = "あ".repeat(TEXT_QUOTE_MAX + 50);
    const a = postTextAnchor("b", long, 0, long.length)!;
    expect(a.end).toBe(long.length);
    expect(a.quote.length).toBe(TEXT_QUOTE_MAX);
    expect(() => validateAnchor(a)).not.toThrow();
    // 切り詰めた引用文でも、本文の同じ位置に合う
    expect(locateTextRange(long, a)).toEqual({ start: 0, end: long.length, moved: false });
  });

  it("保存した範囲を探す: 合えばそのまま、ずれていれば引用文の一番近い出現位置、無ければ null", () => {
    const s = body.indexOf("五月祭を");
    const a = { start: s, end: s + 3, quote: "五月祭" };
    expect(locateTextRange(body, a)).toEqual({ start: s, end: s + 3, moved: false });
    // 本文の先頭に 2 文字足された（古いデータ・改行コードの違いなど）
    const shifted = `ご案内\n${body}`;
    const at = shifted.indexOf("五月祭を");
    expect(locateTextRange(shifted, a)).toEqual({ start: at, end: at + 3, moved: true });
    // 同じ引用文が複数あれば、保存した位置に近い方
    const hash = body.lastIndexOf("五月祭");
    expect(locateTextRange(body, { start: hash + 1, end: hash + 4, quote: "五月祭" })?.start).toBe(
      hash,
    );
    expect(locateTextRange(body, { start: 0, end: 3, quote: "存在しない文" })).toBeNull();
    expect(locateTextRange(body, { start: 5, end: 99999, quote: "" })).toBeNull();
  });
});

describe("SNS の画像の位置（image_rect / image_pin。元画像基準）", () => {
  it("ドラッグの矩形は元画像の中に収め、向きが逆でも正規化する", () => {
    const a = postImageAnchor("i1", { rect: { x: 0.6, y: 0.5, w: -0.3, h: 0.2 } })!;
    expect(a.type).toBe("image_rect");
    if (a.type !== "image_rect") return;
    expect(a.rect.x).toBeCloseTo(0.3);
    expect(a.rect.w).toBeCloseTo(0.3);
    expect(a.rect.y).toBeCloseTo(0.5);
    expect(a.rect.h).toBeCloseTo(0.2);
    const over = postImageAnchor("i1", { rect: { x: 0.8, y: 0.9, w: 0.5, h: 0.5 } })!;
    expect(over).toMatchObject({ type: "image_rect", rect: { x: 0.8, y: 0.9 } });
    if (over.type === "image_rect") {
      expect(over.rect.x + over.rect.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(over.rect.y + over.rect.h).toBeLessThanOrEqual(1 + 1e-9);
      expect(() => validateAnchor(over)).not.toThrow();
    }
  });

  it("小さすぎる矩形は中心のピンにする。点は 0..1 に収める", () => {
    const tiny = postImageAnchor("i1", {
      rect: { x: 0.4, y: 0.4, w: POST_IMAGE_RECT_MIN / 2, h: 0.3 },
    })!;
    expect(tiny.type).toBe("image_pin");
    const pin = postImageAnchor("i1", { point: { x: 1.4, y: -0.2 } })!;
    expect(pin).toEqual({ type: "image_pin", artifactId: "i1", point: { x: 1, y: 0 } });
    expect(postImageAnchor("i1", { point: { x: Number.NaN, y: 0 } })).toBeNull();
    expect(postImageAnchor("i1", { rect: { x: 0, y: 0, w: Number.NaN, h: 1 } })).toBeNull();
  });
});

describe("切り抜き（プレビューの比率と焦点）との往復", () => {
  // 横長の元画像 2000×1000 を 1:1 で見せる: 中央の幅 50% が見える
  const crop = cropRect("1:1", 2000, 1000);
  it("元画像 → 切り抜きの座標。切り抜きの外は null、はみ出す矩形は切る", () => {
    expect(crop).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(pointToCrop({ x: 0.5, y: 0.5 }, crop)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointToCrop({ x: 0.1, y: 0.5 }, crop)).toBeNull();
    const r = rectToCrop({ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, crop)!;
    expect(r.clipped).toBe(true);
    expect(r.rect.x).toBeCloseTo(0);
    expect(r.rect.w).toBeCloseTo(0.3);
    expect(rectToCrop({ x: 0, y: 0, w: 0.2, h: 1 }, crop)).toBeNull();
    const inside = rectToCrop({ x: 0.3, y: 0.1, w: 0.2, h: 0.4 }, crop)!;
    expect(inside.clipped).toBe(false);
    expect(inside.rect).toEqual({ x: expect.closeTo(0.1), y: 0.1, w: expect.closeTo(0.4), h: 0.4 });
  });

  it("切り抜きの上で描いた位置を元画像に戻し、また切り抜きに直すと元の位置になる", () => {
    for (const focusCrop of [
      cropRect("1:1", 2000, 1000),
      cropRect("4:5", 1000, 1000, { x: 0.8, y: 0.5 }),
      cropRect("9:16", 1600, 900, { x: 0.2, y: 0.5 }),
      cropRect("original", 640, 480),
    ]) {
      const drawn = { x: 0.2, y: 0.3, w: 0.4, h: 0.25 };
      const orig = rectFromCrop(drawn, focusCrop);
      const back = rectToCrop(orig, focusCrop)!;
      expect(back.clipped).toBe(false);
      for (const k of ["x", "y", "w", "h"] as const) expect(back.rect[k]).toBeCloseTo(drawn[k]);
      const p = pointFromCrop({ x: 0.7, y: 0.9 }, focusCrop);
      expect(pointToCrop(p, focusCrop)).toEqual({ x: expect.closeTo(0.7), y: expect.closeTo(0.9) });
    }
  });

  it("端末や拡大率に依存しない: 同じ元画像の座標は切り抜きが同じなら同じ位置になる", () => {
    const a = postImageAnchor("i1", {
      rect: rectFromCrop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, crop),
    })!;
    expect(a.type).toBe("image_rect");
    // 保存値は元画像基準なので、画像ビューア（切り抜きなし）では同じ範囲がそのまま見える
    if (a.type === "image_rect") expect(a.rect.x).toBeCloseTo(0.25 + 0.05);
  });
});

describe("アンカー → 記録の中の場所", () => {
  it("添付の対応: 画像は記録の並び、本文は post-body.txt", () => {
    expect(postBodyArtifact(artifacts)?.id).toBe("b");
    expect(postImageArtifacts(post, artifacts).map((a) => a?.id)).toEqual(["i1", "i2"]);
    expect(postImageIndex(post, { fileName: "02-sample.png" })).toBe(1);
    expect(postImageIndex(post, { fileName: "x.png" })).toBe(-1);
    expect(postImageArtifacts({ images: [post.images[0]!] }, [])).toEqual([undefined]);
  });

  it("本文の範囲・画像の矩形とピンを、記録の場所に解決する", () => {
    const s = body.indexOf("詳しく");
    const t = resolvePostAnchor(post, artifacts, postTextAnchor("b", body, s, s + 3)!);
    expect(t).toEqual({ kind: "text", start: s, end: s + 3, quote: "詳しく", moved: false });
    expect(postTargetLabel(t!)).toBe("本文");
    const r = resolvePostAnchor(post, artifacts, {
      type: "image_rect",
      artifactId: "i2",
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    });
    expect(r).toEqual({
      kind: "image",
      index: 1,
      key: "k2",
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    });
    expect(postTargetLabel(r!)).toBe("2 枚目の画像");
    const p = resolvePostAnchor(post, artifacts, {
      type: "image_pin",
      artifactId: "i1",
      point: { x: 0.5, y: 0.5 },
    });
    expect(p).toMatchObject({ kind: "image", index: 0, point: { x: 0.5, y: 0.5 } });
  });

  it("SNS の位置でないもの・記録にない添付・本文が合わないものは null", () => {
    // 本文の添付ではない添付の文章範囲
    expect(
      resolvePostAnchor(post, artifacts, {
        type: "text_range",
        artifactId: "i1",
        start: 0,
        end: 2,
        quote: "第1",
      }),
    ).toBeNull();
    // 記録にない画像
    expect(
      resolvePostAnchor(post, [art("z", "99-other.png", "image")], {
        type: "image_pin",
        artifactId: "z",
        point: { x: 0, y: 0 },
      }),
    ).toBeNull();
    // 添付が版に無い
    expect(
      resolvePostAnchor(post, artifacts, {
        type: "image_pin",
        artifactId: "nope",
        point: { x: 0, y: 0 },
      }),
    ).toBeNull();
    // 他の種類
    expect(
      resolvePostAnchor(post, artifacts, { type: "external", artifactId: "b", note: "" }),
    ).toBeNull();
    // 引用文が本文のどこにも無い
    expect(
      resolvePostAnchor(post, artifacts, {
        type: "text_range",
        artifactId: "b",
        start: 0,
        end: 3,
        quote: "別の本文",
      }),
    ).toBeNull();
  });
});

describe("anchorFitsArtifact（SNS の版）", () => {
  const text: Anchor = { type: "text_range", artifactId: "b", start: 0, end: 5, quote: "第100回" };
  const rect: Anchor = {
    type: "image_rect",
    artifactId: "i1",
    rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  };
  const pin: Anchor = { type: "image_pin", artifactId: "i1", point: { x: 0.5, y: 0.5 } };

  it("本文の範囲は本文の添付に、画像の矩形・ピンは画像の添付に付けられる", () => {
    expect(anchorFitsArtifact(text, artifacts[0]!)).toBe(true);
    expect(anchorFitsArtifact(rect, artifacts[1]!)).toBe(true);
    expect(anchorFitsArtifact(pin, artifacts[2]!)).toBe(true);
  });

  it("種類の合わない添付・内容の記録そのものには付けられない", () => {
    expect(anchorFitsArtifact(text, artifacts[1]!)).toBe(false);
    expect(anchorFitsArtifact(rect, artifacts[0]!)).toBe(false);
    expect(anchorFitsArtifact(pin, artifacts[3]!)).toBe(false);
    expect(anchorFitsArtifact(text, { ...artifacts[3]!, type: "document" })).toBe(false);
  });

  it("文章の範囲が添付の大きさを超えていれば付けられない（大きさが分かるときだけ）", () => {
    expect(anchorFitsArtifact(text, { ...artifacts[0]!, size: 4 })).toBe(false);
    expect(anchorFitsArtifact(text, { ...artifacts[0]!, size: 15 })).toBe(true);
    expect(anchorFitsArtifact(text, { ...artifacts[0]!, size: 0 })).toBe(true);
  });

  it("種類が分からない添付は従来どおり（実体のある添付なら付けられる）", () => {
    expect(anchorFitsArtifact(rect, { role: "source" })).toBe(true);
    expect(
      anchorFitsArtifact(text, { role: "external", externalUrl: "https://example.com/" }),
    ).toBe(false);
  });
});
