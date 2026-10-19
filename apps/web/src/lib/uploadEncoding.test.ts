import { randomBytes } from "node:crypto";
import { MAX_UPLOAD_BYTES } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import {
  UploadTooLargeError,
  encodeForUpload,
  encodingHeaders,
  gunzipBlob,
  sha256Hex,
} from "./uploadEncoding";

/** 転送の本文の用意（利用者指示 2026-10-19「劣化ゼロだけ」）。gzip は元の実体に戻せるときだけ、十分縮むときだけ使う */
const compressible = (bytes: number, prefix = "8BPS ") =>
  new TextEncoder().encode(prefix + "layer data ".repeat(Math.ceil(bytes / 11))).slice(0, bytes);
const file = (data: Uint8Array, name: string, type = "") =>
  new File([data as BlobPart], name, { type });
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe("encodeForUpload", () => {
  it("ダウンロード専用の原本は gzip し、元の実体に戻せる。申告する大きさ・sha256 は元のもの", async () => {
    const data = compressible(600_000);
    let compressing = 0;
    const up = await encodeForUpload(file(data, "poster.psd", "image/vnd.adobe.photoshop"), {
      onCompressing: () => compressing++,
    });
    expect(up.encoding).toBe("gzip");
    expect(compressing).toBe(1);
    expect(up.body.size).toBeLessThan(data.length * 0.1);
    expect(up.originalSize).toBe(data.length);
    expect(up.sha256).toBe(await sha256Hex(data.slice().buffer));
    expect(Buffer.from(await bytesOf(await gunzipBlob(up.body))).equals(data)).toBe(true);
    expect(encodingHeaders(up)).toEqual({
      "X-MF100-Sha256": up.sha256,
      "X-MF100-Encoding": "gzip",
      "X-MF100-Original-Size": String(data.length),
    });
  });

  it("縮みが 10% に満たない（圧縮済みに近い）本文は元のまま", async () => {
    const data = new Uint8Array(randomBytes(400_000));
    const up = await encodeForUpload(file(data, "scan.tif"));
    expect(up.encoding).toBe("identity");
    expect(up.body.size).toBe(data.length);
    expect(encodingHeaders(up)).toEqual({ "X-MF100-Sha256": up.sha256 });
  });

  it("256 KB 未満・PDF・PDF 互換の .ai・JPEG・動画・圧縮済みの容れ物は触らない", async () => {
    let compressing = 0;
    const hooks = { onCompressing: () => compressing++ };
    const big = compressible(500_000);
    expect((await encodeForUpload(file(compressible(200_000), "a.psd"), hooks)).encoding).toBe(
      "identity",
    );
    expect((await encodeForUpload(file(big, "a.pdf", "application/pdf"), hooks)).encoding).toBe(
      "identity",
    );
    expect((await encodeForUpload(file(big, "a.mp4", "video/mp4"), hooks)).encoding).toBe(
      "identity",
    );
    expect((await encodeForUpload(file(big, "a.jpg", "image/jpeg"), hooks)).encoding).toBe(
      "identity",
    );
    expect((await encodeForUpload(file(big, "a.zip", "application/zip"), hooks)).encoding).toBe(
      "identity",
    );
    // PDF 互換の .ai（先頭に %PDF-）は gzip しない。互換でない .ai は gzip する
    const aiPdf = await encodeForUpload(
      file(compressible(500_000, "%PDF-1.6\n"), "a.ai", "application/pdf"),
      hooks,
    );
    expect(aiPdf.encoding).toBe("identity");
    const aiPs = await encodeForUpload(
      file(compressible(500_000, "%!PS-Adobe-3.0\n"), "b.ai"),
      hooks,
    );
    expect(aiPs.encoding).toBe("gzip");
    expect(compressing).toBe(1);
  });

  it("上げる本文（圧縮後）が上限を超えるなら、送る前に断る。縮めて上限に収まるなら通す", async () => {
    const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    // JPEG は触らないので、上限を超える本文のまま → 断る
    await expect(encodeForUpload(file(huge, "big.jpg", "image/jpeg"))).rejects.toBeInstanceOf(
      UploadTooLargeError,
    );
    // 原本は縮められるので、元の大きさが上限を超えても本文は収まる
    const up = await encodeForUpload(file(huge, "big.psd"));
    expect(up.encoding).toBe("gzip");
    expect(up.originalSize).toBe(MAX_UPLOAD_BYTES + 1);
    expect(up.body.size).toBeLessThan(MAX_UPLOAD_BYTES);
  });
});
