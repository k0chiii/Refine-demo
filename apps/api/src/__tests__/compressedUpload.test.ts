import { gzipSync } from "node:zlib";
import { MAX_ORIGINAL_UPLOAD_BYTES, MAX_UPLOAD_BYTES } from "@mf100/domain";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../app.ts";
import type { Sha256Sink } from "../ports.ts";
import {
  FakeGateway,
  MemoryStore,
  fakeVerifier,
  nodeSha256Sink,
  sha256Hex,
  type FakeUploadTarget,
} from "./fakes.ts";

/**
 * gzip で上げた実体（利用者指示 2026-10-19「劣化ゼロだけ」。ダウンロード専用の原本を可逆に圧縮して置く）。
 * 保存は圧縮のまま。申告の元の大きさ・sha256 は伸長しながら確かめ、配信は元の実体を返す。
 */
const ORIGIN = "http://localhost:5173";
let gateway: FakeGateway;
let store: MemoryStore;
let app: ReturnType<typeof createApp>;
/** 伸長した実体が SHA-256 の口へ流れ込んだバイト数（伸長爆弾を申告の大きさで止められたかの確認に使う） */
let hashed = 0;
const countingSink = (): Sha256Sink => {
  const inner = nodeSha256Sink();
  const writer = inner.writable.getWriter();
  return {
    writable: new WritableStream<Uint8Array>({
      async write(chunk) {
        hashed += chunk.byteLength;
        await writer.write(chunk);
      },
      close: () => writer.close(),
    }),
    digest: inner.digest,
  };
};

const target = (over: Partial<FakeUploadTarget>): FakeUploadTarget => ({
  keyPrefix: "works/w1/sessions/s1/0-a.psd",
  mimeType: "image/vnd.adobe.photoshop",
  declaredSize: null,
  fileName: "a.psd",
  owner: "creator",
  status: "pending",
  failureMessage: null,
  objectKey: null,
  open: true,
  size: null,
  ...over,
});

beforeEach(() => {
  hashed = 0;
  gateway = new FakeGateway();
  store = new MemoryStore();
  app = createApp({
    verifier: fakeVerifier,
    gateway,
    store,
    allowedOrigins: [ORIGIN],
    sha256Sink: countingSink,
  });
  gateway.itemUploads.targets.set("psd", target({}));
});

/** 圧縮しやすい原本のつもりの中身（繰り返しの多い文字列） */
const original = new TextEncoder().encode("8BPS layer data ".repeat(40_000));
/** 大きな配列の等価比較は toEqual だと遅いので Buffer で比べる */
const isSame = (a: ArrayBuffer, b: Uint8Array) => Buffer.from(a).equals(b);
const gz = (bytes: Uint8Array) => new Uint8Array(gzipSync(bytes));
const bodyOf = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

async function putGzip(
  itemId: string,
  compressed: Uint8Array,
  over: {
    sha?: string;
    originalSize?: number | string | null;
    headers?: Record<string, string>;
  } = {},
  originalBytes: Uint8Array = original,
) {
  const headers: Record<string, string> = {
    Authorization: "Bearer valid:creator",
    "Content-Type": "application/octet-stream",
    "X-MF100-Sha256": over.sha ?? (await sha256Hex(bodyOf(originalBytes))),
    "X-MF100-Encoding": "gzip",
    ...over.headers,
  };
  const size = over.originalSize === undefined ? originalBytes.byteLength : over.originalSize;
  if (size !== null) headers["X-MF100-Original-Size"] = String(size);
  return app.request(`/uploads/items/${itemId}`, {
    method: "PUT",
    headers,
    body: bodyOf(compressed),
  });
}

const failed = () => gateway.itemUploads.calls.filter((c) => c.startsWith("fail:"));

describe("gzip で上げた実体の検証（PUT /uploads/items/:itemId）", () => {
  it("正しい gzip は圧縮のまま保存し、Convex には元の大きさと元の sha256 で採用を求める", async () => {
    const compressed = gz(original);
    expect(compressed.byteLength).toBeLessThan(original.byteLength / 10);
    const res = await putGzip("psd", compressed);
    expect(res.status).toBe(200);
    const sha = await sha256Hex(bodyOf(original));
    expect(await res.json()).toMatchObject({
      itemId: "psd",
      status: "verified",
      size: original.byteLength,
      sha256: sha,
      encoding: "gzip",
      storedSize: compressed.byteLength,
    });
    const key = gateway.itemUploads.targets.get("psd")!.objectKey!;
    const stored = store.objects.get(key)!;
    expect(stored.bytes).toEqual(compressed);
    expect(stored.encoding).toBe("gzip");
    expect(stored.originalSize).toBe(original.byteLength);
    expect(gateway.itemUploads.targets.get("psd")!.size).toBe(original.byteLength);
    expect(gateway.itemUploads.calls).toContain(`complete:att1:${original.byteLength}:${sha}`);
    expect(hashed).toBe(original.byteLength);
  });

  it("本文の途中が壊れた gzip は保存せず、採用もしない", async () => {
    const compressed = gz(original);
    const broken = compressed.slice();
    for (let i = 100; i < 140; i++) broken[i] = broken[i]! ^ 0xff;
    const res = await putGzip("psd", broken);
    expect(res.status).toBe(400);
    expect(store.objects.size).toBe(0);
    expect(gateway.itemUploads.targets.get("psd")!.status).toBe("failed");
    expect(gateway.itemUploads.calls.some((c) => c.startsWith("complete:"))).toBe(false);
  });

  it("途中で切れた gzip・gzip ではない本文は断る", async () => {
    const compressed = gz(original);
    expect((await putGzip("psd", compressed.slice(0, compressed.length - 20))).status).toBe(400);
    expect((await putGzip("psd", new TextEncoder().encode("not gzip at all"))).status).toBe(400);
    expect(store.objects.size).toBe(0);
    expect(failed()).toHaveLength(2);
  });

  it("元の sha256 の申告が伸長した実体と違えば、保存した実体を消して failed", async () => {
    const res = await putGzip("psd", gz(original), { sha: "0".repeat(64) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "upload_failed" });
    expect(store.objects.size).toBe(0);
    expect(gateway.itemUploads.targets.get("psd")!.status).toBe("failed");
  });

  it("元の大きさの申告が違えば断る（小さい申告・大きい申告のどちらも）", async () => {
    const small = await putGzip("psd", gz(original), { originalSize: original.byteLength - 1 });
    expect(small.status).toBe(400);
    expect(await small.json()).toMatchObject({ code: "size_mismatch" });
    gateway.itemUploads.targets.get("psd")!.status = "pending";
    const large = await putGzip("psd", gz(original), { originalSize: original.byteLength + 1 });
    expect(large.status).toBe(400);
    expect(await large.json()).toMatchObject({ code: "size_mismatch" });
    expect(store.objects.size).toBe(0);
  });

  it("準備で申告された元の大きさと違えば、本文を保存する前に断る", async () => {
    gateway.itemUploads.targets.set("psd", target({ declaredSize: original.byteLength + 5 }));
    const res = await putGzip("psd", gz(original));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "size_mismatch" });
    expect(store.objects.size).toBe(0);
    gateway.itemUploads.targets.set("psd2", target({ declaredSize: original.byteLength }));
    expect((await putGzip("psd2", gz(original))).status).toBe(200);
  });

  it("伸長爆弾: 小さな本文が申告より大きく伸びても、申告の大きさで伸長を止める", async () => {
    const bomb = new Uint8Array(50_000_000); // ゼロ 50 MB は数十 KB の gzip になる
    const compressed = gz(bomb);
    expect(compressed.byteLength).toBeLessThan(100_000);
    const res = await putGzip("psd", compressed, { originalSize: 1000 }, bomb);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "size_mismatch" });
    expect(hashed).toBeLessThanOrEqual(1000);
    expect(store.objects.size).toBe(0);
    expect(gateway.itemUploads.targets.get("psd")!.status).toBe("failed");
  });

  it("元の大きさの申告が上限の 4 倍を超えるなら、試行も始めず 413", async () => {
    const res = await putGzip("psd", gz(original), { originalSize: MAX_ORIGINAL_UPLOAD_BYTES + 1 });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      code: "file_too_large",
      limit: MAX_ORIGINAL_UPLOAD_BYTES,
    });
    expect(gateway.itemUploads.calls).toEqual([]);
    // 4 倍ちょうどは申告としては通る（実体と違うので別の理由で断られる）
    const exact = await putGzip("psd", gz(original), { originalSize: MAX_ORIGINAL_UPLOAD_BYTES });
    expect(exact.status).toBe(400);
  });

  it("上げる本文（圧縮後）の上限は従来どおり。超える本文は読み始める前に 413", async () => {
    const res = await putGzip("psd", gz(original), {
      headers: { "Content-Length": String(MAX_UPLOAD_BYTES + 1) },
    });
    expect(res.status).toBe(413);
    expect(gateway.itemUploads.calls).toEqual([]);
  });

  it("元の大きさの申告が無い・数字でない、知らない符号化は 400（試行も始めない）", async () => {
    expect((await putGzip("psd", gz(original), { originalSize: null })).status).toBe(400);
    expect((await putGzip("psd", gz(original), { originalSize: "12abc" })).status).toBe(400);
    expect((await putGzip("psd", gz(original), { originalSize: "-5" })).status).toBe(400);
    const br = await putGzip("psd", gz(original), { headers: { "X-MF100-Encoding": "br" } });
    expect(br.status).toBe(400);
    expect(await br.json()).toMatchObject({ code: "encoding_unsupported" });
    expect(gateway.itemUploads.calls).toEqual([]);
  });

  it("Range で読む形（PDF・動画）は圧縮して置かない。PDF の見出しを持つ中身も断る", async () => {
    gateway.itemUploads.targets.set(
      "pdf",
      target({ fileName: "a.pdf", mimeType: "application/pdf", keyPrefix: "works/w1/s/pdf" }),
    );
    const refused = await putGzip("pdf", gz(original));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "encoding_not_allowed" });

    gateway.itemUploads.targets.set(
      "ai",
      target({ fileName: "a.ai", mimeType: "application/illustrator", keyPrefix: "works/w1/s/ai" }),
    );
    const pdfLike = new TextEncoder().encode("%PDF-1.6\n" + "AI9 private data ".repeat(20_000));
    const res = await putGzip("ai", gz(pdfLike), {}, pdfLike);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "encoding_not_allowed" });
    expect(store.objects.size).toBe(0);
  });

  it("PDF 互換でない .ai は圧縮して置け、PDF 互換ではないと採用の要求に添える", async () => {
    gateway.itemUploads.targets.set(
      "ai",
      target({
        fileName: "old.ai",
        mimeType: "application/illustrator",
        keyPrefix: "works/w1/s/ai",
      }),
    );
    const ps = new TextEncoder().encode("%!PS-Adobe-3.0 EPSF-3.0\n" + "path data ".repeat(30_000));
    const res = await putGzip("ai", gz(ps), {}, ps);
    expect(res.status).toBe(200);
    expect(gateway.itemUploads.completeMetas).toEqual([{ pdfCompatible: false }]);
  });

  it("従来の（符号化なしの）アップロードは変わらない", async () => {
    const data = bodyOf(original);
    const res = await app.request("/uploads/items/psd", {
      method: "PUT",
      headers: {
        Authorization: "Bearer valid:creator",
        "X-MF100-Sha256": await sha256Hex(data),
        "X-MF100-Encoding": "identity",
      },
      body: data,
    });
    expect(res.status).toBe(200);
    const key = gateway.itemUploads.targets.get("psd")!.objectKey!;
    expect(store.objects.get(key)!.encoding).toBeUndefined();
  });
});

describe("gzip で保存した実体の配信（GET /files/:artifactId）", () => {
  const compressed = gz(original);
  const key = "works/w1/rev1/a.psd";
  let etag: string;

  beforeEach(async () => {
    await store.put(key, bodyOf(compressed), {
      contentType: "image/vnd.adobe.photoshop",
      encoding: "gzip",
      originalSize: original.byteLength,
    });
    gateway.artifacts.set("art", {
      objectKey: key,
      mimeType: "image/vnd.adobe.photoshop",
      fileName: "表紙 案.psd",
      size: original.byteLength,
      viewers: ["reviewer"],
    });
    etag = (await store.head(key))!.etag!;
  });

  const get = (headers: Record<string, string> = {}) =>
    app.request("/files/art", { headers: { Authorization: "Bearer valid:reviewer", ...headers } });

  it("利用者には元の実体をそのまま返す（Content-Encoding は付けず、Content-Length は元の大きさ）", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(isSame(await res.arrayBuffer(), original)).toBe(true);
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(res.headers.get("Content-Length")).toBe(String(original.byteLength));
    expect(res.headers.get("Content-Type")).toBe("image/vnd.adobe.photoshop");
    expect(res.headers.get("ETag")).toBe(etag);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Cache-Control")).toContain("no-transform");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("元のファイル名つきの attachment で返す", async () => {
    const res = await get();
    const disposition = res.headers.get("Content-Disposition")!;
    expect(disposition.startsWith("attachment;")).toBe(true);
    expect(decodeURIComponent(disposition.split("UTF-8''")[1]!)).toBe("表紙 案.psd");
  });

  it("範囲は返さない。Range を付けても全体を 200 で返し、範囲に対応しないと伝える", async () => {
    const res = await get({ Range: "bytes=10-19" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Range")).toBeNull();
    expect(res.headers.get("Accept-Ranges")).toBe("none");
    expect(isSame(await res.arrayBuffer(), original)).toBe(true);
    // 実体の外の範囲・末尾 n バイトでも同じ
    expect((await get({ Range: "bytes=999999999-" })).status).toBe(200);
    expect((await get({ Range: "bytes=-5" })).status).toBe(200);
  });

  it("If-None-Match が当たれば 304（認可は毎回通る）。外れれば全体", async () => {
    const hit = await get({ "If-None-Match": etag });
    expect(hit.status).toBe(304);
    expect(hit.headers.get("ETag")).toBe(etag);
    const miss = await get({ "If-None-Match": '"other"' });
    expect(miss.status).toBe(200);
    expect(isSame(await miss.arrayBuffer(), original)).toBe(true);
    const denied = await app.request("/files/art", {
      headers: { Authorization: "Bearer valid:stranger", "If-None-Match": etag },
    });
    expect(denied.status).toBe(403);
  });

  it("圧縮していない実体は従来どおり範囲を返す（Accept-Ranges: bytes）", async () => {
    const plain = new TextEncoder().encode("%PDF-1.7 plain body");
    await store.put("works/w1/rev1/p.pdf", bodyOf(plain), {
      contentType: "application/pdf",
      sha256Hex: await sha256Hex(bodyOf(plain)),
    });
    gateway.artifacts.set("pdf", {
      objectKey: "works/w1/rev1/p.pdf",
      mimeType: "application/pdf",
      fileName: "p.pdf",
      size: plain.byteLength,
      viewers: ["reviewer"],
    });
    const res = await app.request("/files/pdf", {
      headers: { Authorization: "Bearer valid:reviewer", Range: "bytes=0-3" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Range")).toBe(`bytes 0-3/${plain.byteLength}`);
  });

  it("アップロードして配信まで通すと、アップロードした元の実体が返る", async () => {
    const res = await putGzip("psd", compressed);
    expect(res.status).toBe(200);
    gateway.confirm("psd", "art2", ["reviewer"]);
    const got = await app.request("/files/art2", {
      headers: { Authorization: "Bearer valid:reviewer" },
    });
    expect(isSame(await got.arrayBuffer(), original)).toBe(true);
    expect(got.headers.get("Content-Length")).toBe(String(original.byteLength));
  });
});
