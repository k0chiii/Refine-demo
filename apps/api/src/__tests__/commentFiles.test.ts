import { COMMENT_THUMB_MAX_BYTES } from "@mf100/domain";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../app.ts";
import { purgeOrphanObjects } from "../cleanup.ts";
import type { CleanupGateway } from "../ports.ts";
import {
  FakeGateway,
  MemoryStore,
  fakeVerifier,
  sha256Hex,
  type FakeUploadTarget,
} from "./fakes.ts";

const ORIGIN = "http://localhost:5173";
let gateway: FakeGateway;
let store: MemoryStore;
let app: ReturnType<typeof createApp>;

const KEY = "comments/w1/cf1/photo.webp";
const target = (over: Partial<FakeUploadTarget> = {}): FakeUploadTarget => ({
  keyPrefix: KEY,
  mimeType: "image/webp",
  declaredSize: null,
  fileName: "photo.webp",
  owner: "reviewer",
  status: "pending",
  failureMessage: null,
  objectKey: null,
  open: true,
  size: null,
  ...over,
});

beforeEach(() => {
  gateway = new FakeGateway();
  store = new MemoryStore();
  app = createApp({ verifier: fakeVerifier, gateway, store, allowedOrigins: [ORIGIN] });
  gateway.commentUploads.targets.set("cf1", target());
  gateway.commentThumbs.files.set("cf1", {
    keyPrefix: KEY,
    fileName: "photo.webp",
    owner: "reviewer",
    open: true,
  });
  gateway.commentViewers.set("cf1", { viewers: ["reviewer", "creator"], cacheable: true });
});

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const original = bytes("RIFF....WEBPoriginal-bytes");
const thumb = bytes("RIFF....WEBPthumb");

const putOriginal = async (token: string, data: ArrayBuffer, sha?: string) =>
  app.request("/comment-files/cf1", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "image/webp",
      "X-MF100-Sha256": sha ?? (await sha256Hex(data)),
    },
    body: data,
  });

const putThumb = async (
  token: string,
  data: ArrayBuffer,
  over: { type?: string; sha?: string } = {},
) =>
  app.request("/comment-files/cf1/thumb", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": over.type ?? "image/webp",
      "X-MF100-Sha256": over.sha ?? (await sha256Hex(data)),
    },
    body: data,
  });

const get = (path: string, token: string, headers: Record<string, string> = {}) =>
  app.request(path, { headers: { Authorization: `Bearer ${token}`, ...headers } });

describe("PUT /comment-files/:fileId（原本）", () => {
  it("未認証は 401、他人の添付は 404、sha256 が合えば試行のキーに保存して verified", async () => {
    expect(
      (await app.request("/comment-files/cf1", { method: "PUT", body: original })).status,
    ).toBe(401);
    expect((await putOriginal("valid:creator", original)).status).toBe(404);
    const res = await putOriginal("valid:reviewer", original);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fileId: "cf1", status: "verified" });
    expect([...store.objects.keys()]).toEqual([`${KEY}/attempts/att1`]);
    expect(gateway.commentUploads.calls).toEqual([
      "comment-begin:cf1:att1",
      `comment-complete:att1:${original.byteLength}:${await sha256Hex(original)}`,
    ]);
    // 検証済みには上書きできない
    expect((await putOriginal("valid:reviewer", original)).status).toBe(409);
  });
  it("sha256 不一致は保存せず failed を記録する", async () => {
    const res = await putOriginal("valid:reviewer", original, "0".repeat(64));
    expect(res.status).toBe(400);
    expect(store.objects.size).toBe(0);
    expect(gateway.commentUploads.targets.get("cf1")?.status).toBe("failed");
  });
  it("申告サイズと違う実体は保存せず断る", async () => {
    gateway.commentUploads.targets.set("cf1", target({ declaredSize: 3 }));
    const res = await putOriginal("valid:reviewer", original);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "size_mismatch" });
    expect(store.objects.size).toBe(0);
  });
  it("1 ファイルの上限（100 MB）を超える申告の本文は読む前に 413", async () => {
    const res = await app.request("/comment-files/cf1", {
      method: "PUT",
      headers: {
        Authorization: "Bearer valid:reviewer",
        "X-MF100-Sha256": "a".repeat(64),
        "Content-Length": String(100_000_001),
      },
      body: original,
    });
    expect(res.status).toBe(413);
  });
});

describe("PUT /comment-files/:fileId/thumb（サムネイル）", () => {
  it("webp を固定の置き場に保存し、形式と大きさを Convex に記録させる", async () => {
    const res = await putThumb("valid:reviewer", thumb);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      fileId: "cf1",
      hasThumb: true,
      size: thumb.byteLength,
    });
    expect([...store.objects.keys()]).toEqual([`${KEY}/thumb`]);
    expect(store.objects.get(`${KEY}/thumb`)!.contentType).toBe("image/webp");
    expect(gateway.commentThumbs.files.get("cf1")!.thumb).toEqual({
      size: thumb.byteLength,
      mimeType: "image/webp",
    });
  });
  it("jpeg も可。それ以外の形式は 415", async () => {
    expect((await putThumb("valid:reviewer", thumb, { type: "image/jpeg" })).status).toBe(200);
    expect((await putThumb("valid:reviewer", thumb, { type: "image/png" })).status).toBe(415);
    expect((await putThumb("valid:reviewer", thumb, { type: "application/pdf" })).status).toBe(415);
  });
  it("512 KB を超えると 413（Content-Length が無い本文でも読む途中で止める）", async () => {
    const big = new Uint8Array(COMMENT_THUMB_MAX_BYTES + 1).buffer as ArrayBuffer;
    const declared = await app.request("/comment-files/cf1/thumb", {
      method: "PUT",
      headers: {
        Authorization: "Bearer valid:reviewer",
        "Content-Type": "image/webp",
        "X-MF100-Sha256": "a".repeat(64),
        "Content-Length": String(big.byteLength),
      },
      body: big,
    });
    expect(declared.status).toBe(413);
    // 長さを申告しないストリーム
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= COMMENT_THUMB_MAX_BYTES + 10) return controller.close();
        sent += 64 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    });
    const chunked = await app.request("/comment-files/cf1/thumb", {
      method: "PUT",
      headers: {
        Authorization: "Bearer valid:reviewer",
        "Content-Type": "image/webp",
        "X-MF100-Sha256": "a".repeat(64),
      },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(chunked.status).toBe(413);
    expect(store.objects.size).toBe(0);
    // ちょうど上限は通る
    const exact = new Uint8Array(COMMENT_THUMB_MAX_BYTES).buffer as ArrayBuffer;
    expect((await putThumb("valid:reviewer", exact)).status).toBe(200);
  });
  it("sha256 が無い・不一致は保存しない。空の本文は 400", async () => {
    const noSha = await app.request("/comment-files/cf1/thumb", {
      method: "PUT",
      headers: { Authorization: "Bearer valid:reviewer", "Content-Type": "image/webp" },
      body: thumb,
    });
    expect(noSha.status).toBe(400);
    expect((await putThumb("valid:reviewer", thumb, { sha: "0".repeat(64) })).status).toBe(400);
    expect((await putThumb("valid:reviewer", new ArrayBuffer(0))).status).toBe(400);
    expect(store.objects.size).toBe(0);
    expect(gateway.commentThumbs.files.get("cf1")!.thumb).toBeUndefined();
  });
  it("未認証は 401、他人の添付は 404、付けた後は 409", async () => {
    expect(
      (await app.request("/comment-files/cf1/thumb", { method: "PUT", body: thumb })).status,
    ).toBe(401);
    expect((await putThumb("valid:creator", thumb)).status).toBe(404);
    gateway.commentThumbs.files.get("cf1")!.open = false;
    expect((await putThumb("valid:reviewer", thumb)).status).toBe(409);
    expect(store.objects.size).toBe(0);
  });
});

describe("GET /comment-files/:fileId と …/thumb（配信）", () => {
  beforeEach(async () => {
    await putOriginal("valid:reviewer", original);
    await putThumb("valid:reviewer", thumb);
  });

  it("原本は見られる人にだけ。Bearer 必須で、private no-store・nosniff・ETag・Range 対応（FB と同じ）", async () => {
    expect((await app.request("/comment-files/cf1")).status).toBe(401);
    expect((await get("/comment-files/cf1", "valid:stranger")).status).toBe(403);
    const res = await get("/comment-files/cf1", "valid:creator");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, no-transform");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("ETag")).toBeTruthy();
    expect(res.headers.get("Content-Disposition")).toContain(encodeURIComponent("photo.webp"));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(original));

    const part = await get("/comment-files/cf1", "valid:creator", { Range: "bytes=0-3" });
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe(`bytes 0-3/${original.byteLength}`);

    const etag = res.headers.get("ETag")!;
    const cached = await get("/comment-files/cf1", "valid:creator", { "If-None-Match": etag });
    expect(cached.status).toBe(304);
    // 304 でも認可は毎回通る
    expect(
      (await get("/comment-files/cf1", "valid:stranger", { "If-None-Match": etag })).status,
    ).toBe(403);
  });
  it("サムネイルは private・max-age 1 日・immutable で配信し、認可と ETag は原本と同じ", async () => {
    expect((await get("/comment-files/cf1/thumb", "valid:stranger")).status).toBe(403);
    expect((await app.request("/comment-files/cf1/thumb")).status).toBe(401);
    const res = await get("/comment-files/cf1/thumb", "valid:creator");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "private, max-age=86400, immutable, no-transform",
    );
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(thumb));
    const etag = res.headers.get("ETag")!;
    expect(
      (await get("/comment-files/cf1/thumb", "valid:creator", { "If-None-Match": etag })).status,
    ).toBe(304);
  });
  it("機密の制作物のサムネイルは端末の HTTP キャッシュに残させない", async () => {
    gateway.commentViewers.set("cf1", { viewers: ["creator"], cacheable: false });
    const res = await get("/comment-files/cf1/thumb", "valid:creator");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, no-transform");
  });
  it("画像・PDF 以外の原本は保存させる（ブラウザで開かない）", async () => {
    gateway.commentViewers.set("cf1", {
      viewers: ["creator"],
      cacheable: false,
      attachment: true,
    });
    const res = await get("/comment-files/cf1", "valid:creator");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });
  it("コメントの削除などで認可が外れたら、同じ ETag でも読めない", async () => {
    gateway.commentViewers.delete("cf1");
    expect((await get("/comment-files/cf1", "valid:creator")).status).toBe(403);
    expect((await get("/comment-files/cf1/thumb", "valid:creator")).status).toBe(403);
  });
  it("FB から移した添付は、認可が返す feedback/… のキーの実体を配信する（サムネイルは無い）", async () => {
    const FB_KEY = "feedback/w1/fb1/案.pdf/attempts/att9";
    store.objects.set(FB_KEY, {
      bytes: new Uint8Array(bytes("%PDF-1.7 migrated")),
      contentType: "application/pdf",
    });
    gateway.commentUploads.targets.set(
      "cf-migrated",
      target({
        keyPrefix: "feedback/w1/fb1/案.pdf",
        fileName: "案.pdf",
        mimeType: "application/pdf",
        status: "verified",
        objectKey: FB_KEY,
        open: false,
      }),
    );
    gateway.commentViewers.set("cf-migrated", { viewers: ["creator"], cacheable: false });
    const res = await get("/comment-files/cf-migrated", "valid:creator");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.7 migrated");
    expect((await get("/comment-files/cf-migrated", "valid:stranger")).status).toBe(403);
    expect((await get("/comment-files/cf-migrated/thumb", "valid:creator")).status).toBe(409);
  });
  it("実体が R2 に無ければ 404", async () => {
    store.objects.delete(`${KEY}/thumb`);
    const res = await get("/comment-files/cf1/thumb", "valid:creator");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "object_missing" });
  });
});

describe("清掃: コメントの添付の原本とサムネイル", () => {
  class FakeCleanup implements CleanupGateway {
    purged: string[][] = [];
    async listOrphans() {
      return [
        {
          itemId: "comment:cf1",
          objectKey: `${KEY}/attempts/att1`,
          extraObjectKeys: [`${KEY}/thumb`],
        },
        { itemId: "comment:cf2", objectKey: "comments/w1/cf2/a.zip/attempts/att9" },
      ];
    }
    async markPurged(ids: string[]) {
      this.purged.push(ids);
      return ids.length;
    }
  }
  it("原本とサムネイルの両方を消してから記録する。残すものは消さない", async () => {
    const put = (key: string) =>
      store.objects.set(key, { bytes: new Uint8Array([1]), contentType: "image/webp" });
    put(`${KEY}/attempts/att1`);
    put(`${KEY}/thumb`);
    put("comments/w1/cf2/a.zip/attempts/att9");
    put("comments/w1/cf3/keep.webp/attempts/att1");
    const gw = new FakeCleanup();
    const result = await purgeOrphanObjects({ gateway: gw, store });
    expect(result).toEqual({ listed: 2, purged: 2, failed: [] });
    expect(gw.purged).toEqual([["comment:cf1", "comment:cf2"]]);
    expect([...store.objects.keys()]).toEqual(["comments/w1/cf3/keep.webp/attempts/att1"]);
  });
  it("サムネイルを消し損ねたら記録しない（次回に再試行）", async () => {
    const original = store.delete.bind(store);
    store.delete = async (key: string) => {
      if (key.endsWith("/thumb")) throw new Error("R2 unavailable");
      await original(key);
    };
    const gw = new FakeCleanup();
    const result = await purgeOrphanObjects({ gateway: gw, store });
    expect(result.failed).toEqual([{ itemId: "comment:cf1", message: "R2 unavailable" }]);
    expect(gw.purged).toEqual([["comment:cf2"]]);
  });
});
