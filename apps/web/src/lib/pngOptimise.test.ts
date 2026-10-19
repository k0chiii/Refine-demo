import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { readPngChunks } from "@mf100/domain";
import { initSync, optimise } from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { optimisePngBytes, type PngCodec } from "./pngOptimise.core";

/**
 * PNG の可逆な再最適化（利用者指示 2026-10-19「劣化ゼロだけ」）。本物の oxipng（WASM）で作り直し、
 * 元と結果を同じ復号器（pngjs）で復号して、全画素の RGBA が 1 つも違わないことを確かめる。
 */
const require = createRequire(import.meta.url);
const codec: PngCodec = { optimise: (data) => optimise(data, 2, false, false) };

beforeAll(() => {
  initSync(readFileSync(require.resolve("@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm")));
});

/** 乱数（同じ画像が毎回できるように固定の種） */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

type Pixel = (x: number, y: number, rand: () => number) => [number, number, number, number];

function makePng(
  width: number,
  height: number,
  colorType: 0 | 2 | 4 | 6,
  pixel: Pixel,
  seed = 1,
): Uint8Array {
  const png = new PNG({ width, height });
  const rand = rng(seed);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y, rand);
      const i = (y * width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  return new Uint8Array(
    PNG.sync.write(png, { colorType, inputColorType: 6, inputHasAlpha: true, deflateLevel: 1 }),
  );
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** IDAT の前に付随チャンクを差し込む（CRC つき） */
function withChunks(png: Uint8Array, extra: Array<[string, Uint8Array]>): Uint8Array {
  const chunks = readPngChunks(png)!;
  const firstIdat = chunks.find((c) => c.type === "IDAT")!;
  const pieces: Uint8Array[] = [png.subarray(0, firstIdat.offset)];
  for (const [type, data] of extra) {
    const typeAndData = new Uint8Array(4 + data.length);
    typeAndData.set(Array.from(type, (c) => c.charCodeAt(0)));
    typeAndData.set(data, 4);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(typeAndData, 4);
    view.setUint32(8 + data.length, crc32(typeAndData));
    pieces.push(out);
  }
  pieces.push(png.subarray(firstIdat.offset));
  const total = pieces.reduce((n, p) => n + p.length, 0);
  const merged = new Uint8Array(total);
  let pos = 0;
  for (const p of pieces) {
    merged.set(p, pos);
    pos += p.length;
  }
  return merged;
}

const u32 = (...n: number[]) => {
  const b = new Uint8Array(n.length * 4);
  n.forEach((v, i) => new DataView(b.buffer).setUint32(i * 4, v));
  return b;
};
const text = (s: string) => new TextEncoder().encode(s);

/** 同じ復号器で復号して、縦横と全画素の RGBA が同じか */
function decodedSame(a: Uint8Array, b: Uint8Array): boolean {
  const da = PNG.sync.read(Buffer.from(a));
  const db = PNG.sync.read(Buffer.from(b));
  return da.width === db.width && da.height === db.height && Buffer.compare(da.data, db.data) === 0;
}

const flat: Pixel = (x, y) => [
  (x >> 4) % 2 ? 250 : 20,
  (y >> 4) % 2 ? 240 : 40,
  ((x + y) >> 5) % 2 ? 10 : 200,
  255,
];
const translucent: Pixel = (x, y) => [
  (x * 3) % 256,
  (y * 5) % 256,
  128,
  x < 8 ? 0 : (x * 4 + y) % 256,
];
const noise: Pixel = (_x, _y, rand) => [
  Math.floor(rand() * 256),
  Math.floor(rand() * 256),
  Math.floor(rand() * 256),
  255,
];

describe("PNG の可逆な再最適化", () => {
  const cases: Array<[string, Uint8Array]> = [
    ["色数の少ない画面（RGB）", makePng(160, 120, 2, flat)],
    ["半透明を含む（RGBA）", makePng(160, 120, 6, translucent)],
    [
      "グレー＋透明（4）",
      makePng(120, 90, 4, (x, y) => [(x * 2) % 256, (x * 2) % 256, (x * 2) % 256, (y * 2) % 256]),
    ],
    ["グレー（0）", makePng(120, 90, 0, (x) => [(x * 2) % 256, (x * 2) % 256, (x * 2) % 256, 255])],
    ["ノイズ（ほぼ縮まない）", makePng(80, 60, 2, noise)],
  ];

  for (const [name, png] of cases) {
    it(`${name}: 作り直した結果は元と全画素（透明度を含む）が同じ`, () => {
      const out = codec.optimise(png);
      expect(decodedSame(png, out)).toBe(true);
      const outcome = optimisePngBytes(png, codec);
      if (outcome.kind === "optimised") {
        expect(outcome.bytes.byteLength).toBeLessThanOrEqual(png.byteLength * 0.95);
        expect(decodedSame(png, outcome.bytes)).toBe(true);
      }
    });
  }

  it("色数の少ない画面は大きく縮み、使われる", () => {
    const png = cases[0]![1];
    const outcome = optimisePngBytes(png, codec);
    expect(outcome.kind).toBe("optimised");
    if (outcome.kind === "optimised")
      expect(outcome.bytes.byteLength).toBeLessThan(png.byteLength / 2);
  });

  it("リポジトリの PNG（見本・フィクスチャ）も画素が同じ", () => {
    for (const rel of [
      "../../public/demo-figma/home-pc.png",
      "../../e2e/fixtures/notation-sample.png",
    ]) {
      const original = new Uint8Array(readFileSync(new URL(rel, import.meta.url)));
      const outcome = optimisePngBytes(original, codec);
      expect(outcome.kind).toBe("optimised");
      if (outcome.kind === "optimised") {
        expect(outcome.bytes.byteLength).toBeLessThan(original.byteLength);
        expect(decodedSame(original, outcome.bytes)).toBe(true);
      }
    }
  });

  it("色・実寸を決めるチャンク（ガンマ・sRGB・ICC・pHYs）は同じ内容で残り、text・時刻だけが消えてよい", () => {
    const profile = deflateSync(Buffer.from("fake-icc-profile-data-0123456789"));
    const png = withChunks(cases[0]![1], [
      ["gAMA", u32(45455)],
      ["sRGB", new Uint8Array([0])],
      ["iCCP", new Uint8Array([...text("profile"), 0, 0, ...profile])],
      ["pHYs", new Uint8Array([...u32(11811, 11811), 1])],
      ["tEXt", text("Comment\0 designers note")],
      ["tIME", new Uint8Array([7, 232, 1, 2, 3, 4, 5])],
    ]);
    const outcome = optimisePngBytes(png, codec);
    // 作り直した結果を使うか（構造の確認を通ったか）に関わらず、使うなら見え方のチャンクは残っている
    if (outcome.kind === "optimised") {
      const types = readPngChunks(outcome.bytes)!.map((c) => c.type);
      for (const t of ["gAMA", "sRGB", "iCCP", "pHYs"]) expect(types).toContain(t);
      expect(decodedSame(png, outcome.bytes)).toBe(true);
    } else {
      expect(["rendering_chunk", "small_gain"]).toContain(outcome.reason);
    }
  });

  it("見え方のチャンクを落とす最適化器の結果は使わない（元のまま）", () => {
    const png = withChunks(cases[0]![1], [["gAMA", u32(45455)]]);
    const stripping: PngCodec = { optimise: (data) => codec.optimise(data) };
    const real = stripping.optimise(png);
    // 本物の結果に gAMA が残っているなら、わざと落とした版で確かめる
    const noGamma = withoutChunk(real, "gAMA");
    const outcome = optimisePngBytes(png, { optimise: () => noGamma });
    expect(outcome).toEqual({ kind: "kept", reason: "rendering_chunk" });
  });

  it("縮みが 5% に満たない・壊れた結果・アニメーション PNG・16 ビット色は元のまま", () => {
    const png = cases[1]![1];
    // 小さくなった割合が 5% 未満なら使わない（text を 3% 分だけ足した PNG から、それを外した結果が返る最適化器）
    const padded = withChunks(png, [
      ["tEXt", text("Comment\0" + "x".repeat(Math.floor(png.length * 0.03)))],
    ]);
    expect(optimisePngBytes(padded, { optimise: (d) => withoutChunk(d, "tEXt") })).toEqual({
      kind: "kept",
      reason: "small_gain",
    });
    const paddedMore = withChunks(png, [
      ["tEXt", text("Comment\0" + "x".repeat(Math.floor(png.length * 0.08)))],
    ]);
    expect(optimisePngBytes(paddedMore, { optimise: (d) => withoutChunk(d, "tEXt") }).kind).toBe(
      "optimised",
    );
    const broken: PngCodec = { optimise: () => new Uint8Array([1, 2, 3]) };
    expect(optimisePngBytes(png, broken)).toEqual({ kind: "kept", reason: "malformed" });
    const animated = withChunks(png, [["acTL", u32(2, 0)]]);
    expect(optimisePngBytes(animated, codec)).toEqual({ kind: "kept", reason: "animated" });
    const deep = PNG.sync.write(new PNG({ width: 8, height: 8 }), { colorType: 6, bitDepth: 16 });
    expect(optimisePngBytes(new Uint8Array(deep), codec)).toEqual({
      kind: "kept",
      reason: "high_bit_depth",
    });
    expect(optimisePngBytes(new Uint8Array([1, 2, 3]), codec)).toMatchObject({ kind: "kept" });
  });
});

/** チャンクを 1 種類取り除いた PNG（テスト用） */
function withoutChunk(png: Uint8Array, type: string): Uint8Array {
  const chunks = readPngChunks(png)!;
  const pieces: Uint8Array[] = [png.subarray(0, 8)];
  for (const c of chunks)
    if (c.type !== type) pieces.push(png.subarray(c.offset, c.offset + 12 + c.length));
  const merged = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of pieces) {
    merged.set(p, pos);
    pos += p.length;
  }
  return merged;
}
