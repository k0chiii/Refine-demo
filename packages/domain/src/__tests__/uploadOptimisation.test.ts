import { describe, expect, it } from "vite-plus/test";
import {
  GZIP_MIN_BYTES,
  MAX_ORIGINAL_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  PNG_OPTIMISE_MAX_BYTES,
  PNG_OPTIMISE_MAX_PIXELS,
  PNG_OPTIMISE_MIN_BYTES,
  acceptPngOptimisation,
  assertDeclaredSizeWithinLimit,
  checkPngForOptimisation,
  isGzipAllowed,
  isGzipCandidate,
  looksCompressed,
  maxDeclaredBytesFor,
  parseUploadEncoding,
  planUploadOptimisation,
  readPngChunks,
  readPngHeader,
  savedEnough,
} from "../index.ts";

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [
    (len >>> 24) & 255,
    (len >>> 16) & 255,
    (len >>> 8) & 255,
    len & 255,
    ...Array.from(type, (c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0, // CRC は見ない
  ];
}

function ihdr(width: number, height: number, bitDepth = 8, colourType = 2) {
  const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return chunk("IHDR", [...be(width), ...be(height), bitDepth, colourType, 0, 0, 0]);
}

function png(chunks: number[][], width = 4, height = 4, colourType = 2, bitDepth = 8): Uint8Array {
  return new Uint8Array([
    ...SIG,
    ...ihdr(width, height, bitDepth, colourType),
    ...chunks.flat(),
    ...chunk("IEND", []),
  ]);
}

const bytes = (...b: number[]) => new Uint8Array(b);
const head = (s: string) => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));

describe("savedEnough / parseUploadEncoding", () => {
  it("閾値ちょうどは得とみなし、わずかな得・増えたときは使わない", () => {
    expect(savedEnough(1000, 950, 0.05)).toBe(true);
    expect(savedEnough(1000, 951, 0.05)).toBe(false);
    expect(savedEnough(1000, 1000, 0.05)).toBe(false);
    expect(savedEnough(1000, 1200, 0.1)).toBe(false);
    expect(savedEnough(0, 0, 0.1)).toBe(false);
  });
  it("符号化は無し・identity・gzip だけ。知らない値は受けない", () => {
    expect(parseUploadEncoding(undefined)).toBe("identity");
    expect(parseUploadEncoding("")).toBe("identity");
    expect(parseUploadEncoding("GZIP")).toBe("gzip");
    expect(parseUploadEncoding("br")).toBeNull();
    expect(parseUploadEncoding("gzip, deflate")).toBeNull();
  });
});

describe("gzip の対象", () => {
  const big = GZIP_MIN_BYTES;
  const plan = (fileName: string, mimeType: string, size = big, h = bytes(1, 2, 3, 4)) =>
    planUploadOptimisation({ fileName, mimeType, size }, h);

  it("ダウンロード専用の原本は gzip する（psd・indd・eps・tif・MIME の無い原本）", () => {
    expect(plan("a.psd", "image/vnd.adobe.photoshop")).toBe("gzip");
    expect(plan("a.indd", "")).toBe("gzip");
    expect(plan("a.eps", "application/postscript")).toBe("gzip");
    expect(plan("a.tif", "image/tiff")).toBe("gzip");
    expect(plan("a.tiff", "")).toBe("gzip");
    expect(plan("a.sketchx", "application/octet-stream")).toBe("gzip");
  });
  it("256 KB 未満は対象外、ちょうどは対象", () => {
    expect(plan("a.psd", "", GZIP_MIN_BYTES - 1)).toBe("none");
    expect(plan("a.psd", "", GZIP_MIN_BYTES)).toBe("gzip");
  });
  it("PDF・動画・音声・JPEG・WebP・文章・圧縮済みの容れ物はそのまま", () => {
    for (const [name, mime] of [
      ["a.pdf", "application/pdf"],
      ["a.mp4", "video/mp4"],
      ["a.mov", ""],
      ["a.mp3", "audio/mpeg"],
      ["a.jpg", "image/jpeg"],
      ["a.webp", "image/webp"],
      ["a.gif", "image/gif"],
      ["a.md", "text/markdown"],
      ["a.zip", "application/zip"],
      ["a.docx", "application/octet-stream"],
    ] as const)
      expect(plan(name, mime), name).toBe("none");
  });
  it(".ai は PDF 互換（先頭に %PDF-）なら gzip しない。互換でなければ gzip する", () => {
    expect(plan("a.ai", "application/illustrator", big, head("%PDF-1.6\n"))).toBe("none");
    expect(plan("a.ai", "application/pdf", big, head("%!PS-Adobe-3.0"))).toBe("gzip");
    expect(plan("a.ai", "", big, head("%!PS-Adobe-3.0"))).toBe("gzip");
    // 見出しは先頭 1024 バイトのどこにあってもよい
    const late = new Uint8Array(300);
    late.set(head("%PDF-1.5"), 200);
    expect(plan("a.ai", "", big, late)).toBe("none");
  });
  it("拡張子が原本でも、中身が圧縮済みなら gzip しない", () => {
    expect(plan("a.bin", "", big, bytes(0x50, 0x4b, 0x03, 0x04))).toBe("none");
    expect(plan("a.bin", "", big, bytes(0x1f, 0x8b, 8))).toBe("none");
    expect(plan("a.bin", "", big, bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("none");
    expect(looksCompressed(head("....ftypmp42"))).toBe(true);
    expect(looksCompressed(head("RIFF....WEBP"))).toBe(true);
    expect(looksCompressed(head("8BPS"))).toBe(false);
  });
  it("gzip できる種類は準備のときの元サイズ上限が 4 倍、そうでなければ従来の上限", () => {
    expect(MAX_ORIGINAL_UPLOAD_BYTES).toBe(4 * MAX_UPLOAD_BYTES);
    expect(maxDeclaredBytesFor({ fileName: "a.psd", mimeType: "" })).toBe(
      MAX_ORIGINAL_UPLOAD_BYTES,
    );
    expect(maxDeclaredBytesFor({ fileName: "a.pdf", mimeType: "application/pdf" })).toBe(
      MAX_UPLOAD_BYTES,
    );
    expect(maxDeclaredBytesFor({ fileName: "a.mp4", mimeType: "video/mp4" })).toBe(
      MAX_UPLOAD_BYTES,
    );
    expect(() =>
      assertDeclaredSizeWithinLimit({
        fileName: "a.psd",
        mimeType: "",
        size: 3 * MAX_UPLOAD_BYTES,
      }),
    ).not.toThrow();
    expect(() =>
      assertDeclaredSizeWithinLimit({
        fileName: "a.psd",
        mimeType: "",
        size: 4 * MAX_UPLOAD_BYTES + 1,
      }),
    ).toThrow(expect.objectContaining({ code: "upload_file_too_large" }));
    expect(() =>
      assertDeclaredSizeWithinLimit({
        fileName: "a.pdf",
        mimeType: "application/pdf",
        size: MAX_UPLOAD_BYTES + 1,
      }),
    ).toThrow(expect.objectContaining({ code: "upload_file_too_large" }));
    expect(isGzipCandidate({ fileName: "a.ai", mimeType: "application/pdf" })).toBe(true);
  });
  it("Worker は PDF・動画・音声と、PDF の見出しを持つ中身の gzip を受けない", () => {
    expect(isGzipAllowed({ fileName: "a.psd", mimeType: "" }, head("8BPS"))).toBe(true);
    expect(isGzipAllowed({ fileName: "a.pdf", mimeType: "application/pdf" })).toBe(false);
    expect(isGzipAllowed({ fileName: "a.mp4", mimeType: "video/mp4" })).toBe(false);
    expect(
      isGzipAllowed({ fileName: "a.ai", mimeType: "application/illustrator" }, head("%PDF-1.4")),
    ).toBe(false);
    expect(
      isGzipAllowed({ fileName: "a.ai", mimeType: "application/illustrator" }, head("%!PS")),
    ).toBe(true);
  });
});

describe("PNG の対象と構造の確認", () => {
  const pngHead = bytes(...SIG, 0, 0, 0, 13);
  const plan = (fileName: string, size: number, mimeType = "image/png") =>
    planUploadOptimisation({ fileName, mimeType, size }, pngHead);

  it("PNG は 16 KB 以上 40 MB 以下だけ試す（署名が PNG でなければ試さない）", () => {
    expect(plan("a.png", PNG_OPTIMISE_MIN_BYTES)).toBe("png");
    expect(plan("a.png", PNG_OPTIMISE_MIN_BYTES - 1)).toBe("none");
    expect(plan("a.png", PNG_OPTIMISE_MAX_BYTES)).toBe("png");
    expect(plan("a.png", PNG_OPTIMISE_MAX_BYTES + 1)).toBe("none");
    expect(plan("shot", 100_000, "image/png")).toBe("png");
    expect(
      planUploadOptimisation(
        { fileName: "a.png", mimeType: "image/png", size: 100_000 },
        bytes(0xff, 0xd8, 0xff),
      ),
    ).toBe("none");
  });

  it("チャンクと見出しを読める。壊れた・途中で切れた PNG は読まない", () => {
    const p = png([chunk("tEXt", [65, 0, 66]), chunk("IDAT", [1, 2, 3])], 7, 5);
    expect(readPngChunks(p)?.map((c) => c.type)).toEqual(["IHDR", "tEXt", "IDAT", "IEND"]);
    expect(readPngHeader(p)).toMatchObject({ width: 7, height: 5, bitDepth: 8, colourType: 2 });
    expect(readPngChunks(p.subarray(0, p.length - 5))).toBeNull();
    expect(readPngChunks(bytes(1, 2, 3))).toBeNull();
  });

  it("アニメーション PNG・16 ビット色・画素数が多すぎる PNG・壊れた PNG は触らない", () => {
    expect(checkPngForOptimisation(png([chunk("IDAT", [1])]))).toEqual({ ok: true });
    expect(
      checkPngForOptimisation(png([chunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]), chunk("IDAT", [1])])),
    ).toEqual({
      ok: false,
      reason: "animated",
    });
    const huge = png([chunk("IDAT", [1])], PNG_OPTIMISE_MAX_PIXELS, 2);
    expect(checkPngForOptimisation(huge)).toEqual({ ok: false, reason: "too_many_pixels" });
    expect(checkPngForOptimisation(png([chunk("IDAT", [1])], 4, 4, 2, 16))).toEqual({
      ok: false,
      reason: "high_bit_depth",
    });
    expect(checkPngForOptimisation(bytes(1, 2, 3))).toEqual({ ok: false, reason: "not_png" });
    expect(checkPngForOptimisation(bytes(...SIG, 0, 0, 0, 13))).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("見え方を決めるチャンク（ICC・ガンマ・sRGB・実寸）が同じ内容で残っていれば受け、text・時刻の欠落は問わない", () => {
    const icc = chunk("iCCP", [80, 0, 0, 9, 9]);
    const original = png([
      icc,
      chunk("gAMA", [0, 1, 134, 160]),
      chunk("tEXt", [65, 0, 66]),
      chunk("tIME", [7, 232, 1, 1, 0, 0, 0]),
      chunk("IDAT", [1, 2, 3, 4]),
    ]);
    const stripped = png([icc, chunk("gAMA", [0, 1, 134, 160]), chunk("IDAT", [9])]);
    expect(acceptPngOptimisation(original, stripped)).toEqual({ ok: true });
    // ICC が消えた・変わった
    expect(
      acceptPngOptimisation(original, png([chunk("gAMA", [0, 1, 134, 160]), chunk("IDAT", [9])])),
    ).toEqual({
      ok: false,
      reason: "rendering_chunk",
    });
    expect(
      acceptPngOptimisation(
        original,
        png([chunk("iCCP", [80, 0, 0, 9, 8]), chunk("gAMA", [0, 1, 134, 160]), chunk("IDAT", [9])]),
      ),
    ).toEqual({ ok: false, reason: "rendering_chunk" });
    // 実寸（pHYs）も残す
    const withPhys = png([chunk("pHYs", [0, 0, 11, 19, 0, 0, 11, 19, 1]), chunk("IDAT", [1])]);
    expect(acceptPngOptimisation(withPhys, png([chunk("IDAT", [1])]))).toEqual({
      ok: false,
      reason: "rendering_chunk",
    });
  });

  it("縦横が変わった・読めない結果は使わない。色の持ち方（RGB→パレット）の変更は画素が同じなら許す", () => {
    const a = png([chunk("IDAT", [1])], 4, 4, 2);
    expect(acceptPngOptimisation(a, png([chunk("IDAT", [1])], 4, 5, 2))).toEqual({
      ok: false,
      reason: "dimensions",
    });
    expect(acceptPngOptimisation(a, bytes(1, 2, 3))).toEqual({ ok: false, reason: "malformed" });
    expect(
      acceptPngOptimisation(a, png([chunk("PLTE", [0, 0, 0]), chunk("IDAT", [1])], 4, 4, 3)),
    ).toEqual({
      ok: true,
    });
  });
});
