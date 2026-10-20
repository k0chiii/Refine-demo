import { COMMENT_THUMB_MAX_BYTES } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import {
  ATTACHMENT_AVIF_TRY_ABOVE_BYTES,
  ATTACHMENT_MAX_LONG_SIDE,
  ATTACHMENT_MIN_GAIN,
  ATTACHMENT_SKIP_RECODE_BELOW_BYTES,
  ATTACHMENT_THUMB_LONG_SIDE,
  fitWithin,
  guessImageMime,
  isAnimatedGif,
  isCompressibleImage,
  nameForPasted,
  pickSmallest,
  renamedFor,
} from "./attachmentCompress.core";
import {
  compressImage,
  type ImageEnv,
  type ImageSource,
  type Surface,
} from "./attachmentCompress.engine";

// ---------------------------------------------------------------- 純粋な取り決め

describe("fitWithin（長辺 2560 に収める）", () => {
  it("収まる画像は大きさを変えない（拡大しない）", () => {
    expect(fitWithin({ width: 1200, height: 800 }, 2560)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin({ width: 2560, height: 2560 }, 2560)).toEqual({ width: 2560, height: 2560 });
  });
  it("長辺が超えるなら縦横比を保って縮める", () => {
    expect(fitWithin({ width: 5120, height: 2880 }, 2560)).toEqual({ width: 2560, height: 1440 });
    expect(fitWithin({ width: 3000, height: 6000 }, 2560)).toEqual({ width: 1280, height: 2560 });
  });
  it("極端な縦横比でも各辺は 1 px 以上", () => {
    expect(fitWithin({ width: 100000, height: 10 }, 2560)).toEqual({ width: 2560, height: 1 });
  });
});

describe("pickSmallest（どの出力を採るか）", () => {
  it("縮めていない画像は、元より 5% 以上小さい候補があるときだけ作り直しを採る", () => {
    const original = 1000;
    expect(pickSmallest(original, [{ kind: "webp", size: 960 }], { resized: false })).toBeNull();
    expect(
      pickSmallest(original, [{ kind: "webp", size: original * (1 - ATTACHMENT_MIN_GAIN) }], {
        resized: false,
      }),
    ).toEqual({ kind: "webp", size: 950 });
    expect(pickSmallest(original, [{ kind: "webp", size: 1200 }], { resized: false })).toBeNull();
  });
  it("縮めた画像は、元より小さければ採る", () => {
    expect(pickSmallest(1000, [{ kind: "webp", size: 990 }], { resized: true })).toEqual({
      kind: "webp",
      size: 990,
    });
    expect(pickSmallest(1000, [{ kind: "webp", size: 1000 }], { resized: true })).toBeNull();
  });
  it("複数の候補ではいちばん小さいものを採る。0 バイトの候補は無視する", () => {
    expect(
      pickSmallest(
        10_000,
        [
          { kind: "webp", size: 5000 },
          { kind: "avif", size: 3000 },
          { kind: "bad", size: 0 },
        ],
        { resized: false },
      ),
    ).toEqual({ kind: "avif", size: 3000 });
    expect(pickSmallest(10_000, [], { resized: false })).toBeNull();
  });
});

describe("対象の判定と名前", () => {
  it("PNG・JPEG・WebP・AVIF・HEIC・GIF は対象、SVG と PDF は対象外", () => {
    const f = (name: string, type: string) => ({ name, type });
    for (const [n, t] of [
      ["a.png", "image/png"],
      ["a.jpg", "image/jpeg"],
      ["a.webp", "image/webp"],
      ["a.avif", "image/avif"],
      ["a.heic", "image/heic"],
      ["a.gif", "image/gif"],
      ["a.PNG", ""],
    ] as const)
      expect(isCompressibleImage(f(n, t))).toBe(true);
    expect(isCompressibleImage(f("a.svg", "image/svg+xml"))).toBe(false);
    expect(isCompressibleImage(f("a.svg", ""))).toBe(false);
    expect(isCompressibleImage(f("a.pdf", "application/pdf"))).toBe(false);
    expect(isCompressibleImage(f("a.zip", ""))).toBe(false);
  });
  it("種類が空なら拡張子から推す", () => {
    expect(guessImageMime({ name: "x.JPG", type: "" })).toBe("image/jpeg");
    expect(guessImageMime({ name: "x.png", type: "image/png; x=1" })).toBe("image/png");
    expect(guessImageMime({ name: "x", type: "" })).toBe("application/octet-stream");
  });
  it("作り直した画像の名前は拡張子を形式に合わせる", () => {
    expect(renamedFor("写真.png", "image/webp")).toBe("写真.webp");
    expect(renamedFor("a.b.jpeg", "image/avif")).toBe("a.b.avif");
    expect(renamedFor("noext", "image/webp")).toBe("noext.webp");
    expect(renamedFor(".png", "image/webp")).toBe("image.webp");
  });
  it("貼り付けた画像の名前: 名前が無い・image.png のときは日時から付ける", () => {
    const now = new Date(2026, 9, 20, 9, 5, 7);
    expect(nameForPasted({ name: "image.png", type: "image/png" }, now)).toBe(
      "画像 2026-10-20 090507.png",
    );
    expect(nameForPasted({ name: "", type: "image/jpeg" }, now)).toBe("画像 2026-10-20 090507.jpg");
    expect(nameForPasted({ name: "mock.png", type: "image/png" }, now)).toBe("mock.png");
  });
});

/** 論理画面記述子 + 画像ブロックの数だけ並べた最小の GIF */
function gif(frames: number, opts: { trailer?: boolean } = {}): Uint8Array {
  const bytes: number[] = [...new TextEncoder().encode("GIF89a"), 1, 0, 1, 0, 0, 0, 0];
  for (let i = 0; i < frames; i++) {
    // 拡張: Graphic Control（アニメーションの 1 コマごとにあるもの）
    bytes.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0);
    // 画像ブロック（ローカルカラーテーブル無し・LZW 最小コード長 2・データ 1 ブロック）
    bytes.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0);
  }
  if (opts.trailer !== false) bytes.push(0x3b);
  return new Uint8Array(bytes);
}

describe("isAnimatedGif", () => {
  it("1 コマの GIF は動かない、2 コマ以上は動く", () => {
    expect(isAnimatedGif(gif(1))).toBe(false);
    expect(isAnimatedGif(gif(2))).toBe(true);
    expect(isAnimatedGif(gif(5))).toBe(true);
  });
  it("壊れている・途中までしか読めていない GIF は動くものとして扱う（触らない）", () => {
    expect(isAnimatedGif(new Uint8Array([1, 2, 3]))).toBe(true);
    expect(isAnimatedGif(gif(1, { trailer: false }))).toBe(true);
    expect(isAnimatedGif(gif(1).subarray(0, 20))).toBe(true);
  });
});

// ---------------------------------------------------------------- engine（環境は差し込み）

interface FakeOptions {
  /** 形式ごとに出力の大きさを決める（寸法と品質から） */
  sizeOf?: (type: string, quality: number, w: number, h: number) => number;
  supported?: string[];
}

function fakeEnv(source: { width: number; height: number }, opts: FakeOptions = {}) {
  const supported = new Set(opts.supported ?? ["image/webp"]);
  const calls: Array<{ type: string; quality: number; width: number; height: number }> = [];
  const draws: Array<{ width: number; height: number }> = [];
  const sizeOf = opts.sizeOf ?? ((_t, q, w, h) => Math.round(w * h * q * 0.1));
  const surface = (width: number, height: number): Surface => ({
    width,
    height,
    async encode(type, quality) {
      if (!supported.has(type)) return null;
      calls.push({ type, quality, width, height });
      return new Blob([new Uint8Array(sizeOf(type, quality, width, height))], { type });
    },
    resize: (w, h) => {
      draws.push({ width: w, height: h });
      return surface(w, h);
    },
    close() {},
  });
  const env: ImageEnv = {
    async decode() {
      const s: ImageSource = { ...source, close() {} };
      return s;
    },
    draw(_s, w, h) {
      draws.push({ width: w, height: h });
      return surface(w, h);
    },
    async canEncode(type) {
      return supported.has(type);
    },
  };
  return { env, calls, draws };
}

const blobOf = (n: number) => new Blob([new Uint8Array(n)]);

describe("compressImage（手順）", () => {
  it("大きな画像は長辺 2560 に縮めて WebP（品質 0.8）にし、サムネイルは長辺 480・品質 0.7", async () => {
    const { env, calls } = fakeEnv({ width: 4000, height: 3000 });
    const r = await compressImage(blobOf(4_000_000), env, {
      originalSize: 4_000_000,
      recode: "auto",
    });
    expect(r.width).toBe(2560);
    expect(r.height).toBe(1920);
    expect(r.body?.type).toBe("image/webp");
    expect(r.trace.resized).toBe(true);
    expect(calls[0]).toMatchObject({ type: "image/webp", quality: 0.8, width: 2560, height: 1920 });
    expect(calls.at(-1)).toMatchObject({
      type: "image/webp",
      quality: 0.7,
      width: ATTACHMENT_THUMB_LONG_SIDE,
      height: 360,
    });
    expect(r.thumb?.type).toBe("image/webp");
  });
  it("元のほうが小さければ元を送る（寸法も元のまま）。サムネイルは作る", async () => {
    // WebP が元より大きくなる画像
    const { env } = fakeEnv(
      { width: 1000, height: 800 },
      { sizeOf: (_t, q, w, h) => (q === 0.8 ? 500_000 : w * h * 0.01) },
    );
    const r = await compressImage(blobOf(200_000), env, { originalSize: 200_000, recode: "auto" });
    expect(r.body).toBeNull();
    expect({ w: r.width, h: r.height }).toEqual({ w: 1000, h: 800 });
    expect(r.thumb).not.toBeNull();
  });
  it("わずかしか縮まない（5% 未満）なら作り直さない", async () => {
    const { env } = fakeEnv(
      { width: 1000, height: 800 },
      { sizeOf: (_t, q) => (q === 0.8 ? 96_000 : 1000) },
    );
    const r = await compressImage(blobOf(100_000), env, { originalSize: 100_000, recode: "auto" });
    expect(r.body).toBeNull();
  });
  it("小さい画像（24 KB 未満・縮める必要なし）は作り直さずサムネイルだけ作る", async () => {
    const { env, calls } = fakeEnv({ width: 300, height: 200 });
    const r = await compressImage(blobOf(ATTACHMENT_SKIP_RECODE_BELOW_BYTES - 1), env, {
      originalSize: ATTACHMENT_SKIP_RECODE_BELOW_BYTES - 1,
      recode: "auto",
    });
    expect(r.body).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ quality: 0.7, width: 300, height: 200 }); // 拡大しない
  });
  it("小さくても長辺が 2560 を超えるなら縮める", async () => {
    const { env } = fakeEnv({ width: 5000, height: 100 }, { sizeOf: () => 1000 });
    const r = await compressImage(blobOf(10_000), env, { originalSize: 10_000, recode: "auto" });
    expect(r.body?.type).toBe("image/webp");
    expect(r.width).toBe(ATTACHMENT_MAX_LONG_SIDE);
  });
  it("AVIF を作れる環境では試し、WebP より小さければ AVIF を採る。WebP が十分小さければ試さない", async () => {
    const sizeOf = (t: string) => (t === "image/avif" ? 300_000 : 500_000);
    const a = fakeEnv(
      { width: 3000, height: 2000 },
      { supported: ["image/webp", "image/avif"], sizeOf },
    );
    const r = await compressImage(blobOf(6_000_000), a.env, {
      originalSize: 6_000_000,
      recode: "auto",
    });
    expect(r.body?.type).toBe("image/avif");
    expect(r.trace).toMatchObject({ webpSize: 500_000, avifSize: 300_000 });

    const small = fakeEnv(
      { width: 3000, height: 2000 },
      { supported: ["image/webp", "image/avif"], sizeOf: () => ATTACHMENT_AVIF_TRY_ABOVE_BYTES },
    );
    const s = await compressImage(blobOf(6_000_000), small.env, {
      originalSize: 6_000_000,
      recode: "auto",
    });
    expect(s.trace.avifSize).toBeNull();
    expect(small.calls.some((c) => c.type === "image/avif")).toBe(false);

    // AVIF を作れない環境（既定）では試さない
    const none = fakeEnv({ width: 3000, height: 2000 }, { sizeOf });
    await compressImage(blobOf(6_000_000), none.env, { originalSize: 6_000_000, recode: "auto" });
    expect(none.calls.some((c) => c.type === "image/avif")).toBe(false);
  });
  it("AVIF のほうが大きければ WebP を採る", async () => {
    const e = fakeEnv(
      { width: 3000, height: 2000 },
      {
        supported: ["image/webp", "image/avif"],
        sizeOf: (t) => (t === "image/avif" ? 900_000 : 500_000),
      },
    );
    const r = await compressImage(blobOf(6_000_000), e.env, {
      originalSize: 6_000_000,
      recode: "auto",
    });
    expect(r.body?.type).toBe("image/webp");
  });
  it("アニメーション GIF（never）は本体を作り直さず、サムネイルだけ作る", async () => {
    const { env, calls } = fakeEnv({ width: 800, height: 600 });
    const r = await compressImage(blobOf(3_000_000), env, {
      originalSize: 3_000_000,
      recode: "never",
    });
    expect(r.body).toBeNull();
    expect(r.thumb).not.toBeNull();
    expect(calls).toHaveLength(1);
  });
  it("HEIC など画像として見せられないもの（force）は、元より大きくなっても作り直した画像を送る", async () => {
    const { env } = fakeEnv({ width: 800, height: 600 }, { sizeOf: () => 900_000 });
    const r = await compressImage(blobOf(100_000), env, { originalSize: 100_000, recode: "force" });
    expect(r.body?.type).toBe("image/webp");
  });
  it("WebP を書き出せない環境では本体は元のまま、サムネイルは JPEG", async () => {
    const { env } = fakeEnv(
      { width: 3000, height: 2000 },
      { supported: ["image/jpeg"], sizeOf: () => 20_000 },
    );
    const r = await compressImage(blobOf(6_000_000), env, {
      originalSize: 6_000_000,
      recode: "auto",
    });
    expect(r.body).toBeNull();
    expect(r.thumb?.type).toBe("image/jpeg");
  });
  it("サムネイルが 512 KB を超えたら品質を下げて作り直し、それでも収まらなければ作らない", async () => {
    const tooBig = COMMENT_THUMB_MAX_BYTES + 1;
    const lower = fakeEnv(
      { width: 1000, height: 1000 },
      { sizeOf: (_t, q) => (q === 0.7 ? tooBig : 100_000) },
    );
    const r = await compressImage(blobOf(10_000), lower.env, {
      originalSize: 10_000,
      recode: "never",
    });
    expect(r.thumb?.blob.size).toBe(100_000);
    const never = fakeEnv({ width: 1000, height: 1000 }, { sizeOf: () => tooBig });
    expect(
      (await compressImage(blobOf(10_000), never.env, { originalSize: 10_000, recode: "never" }))
        .thumb,
    ).toBeNull();
  });
  it("復号できなければ例外（呼び出し側は元のまま送る）", async () => {
    const env: ImageEnv = {
      async decode() {
        throw new Error("cannot decode");
      },
      draw: () => {
        throw new Error("unreachable");
      },
      canEncode: async () => true,
    };
    await expect(
      compressImage(blobOf(10), env, { originalSize: 10, recode: "auto" }),
    ).rejects.toThrow("cannot decode");
  });
  it("縮めた画像のサムネイルは、本体用に描いた画像から段階的に縮める", async () => {
    const { env, draws } = fakeEnv({ width: 8000, height: 6000 });
    await compressImage(blobOf(9_000_000), env, { originalSize: 9_000_000, recode: "auto" });
    // 元 → 2560×1920 → 480×360
    expect(draws).toEqual([
      { width: 2560, height: 1920 },
      { width: 480, height: 360 },
    ]);
  });
});
