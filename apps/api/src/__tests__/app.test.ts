import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../app.ts";
import { FakeGateway, MemoryStore, fakeVerifier, sha256Hex } from "./fakes.ts";

const ORIGIN = "http://localhost:5173";
let gateway: FakeGateway;
let store: MemoryStore;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  gateway = new FakeGateway();
  store = new MemoryStore();
  app = createApp({ verifier: fakeVerifier, gateway, store, allowedOrigins: [ORIGIN] });
  gateway.items.set("item1", { objectKey: "works/w1/sessions/s1/0-a.pdf", mimeType: "application/pdf", declaredSize: null, fileName: "a.pdf", owner: "creator", status: "pending", failureMessage: null });
  gateway.items.set("item2", { objectKey: "works/w1/sessions/s1/1-b.pdf", mimeType: "application/pdf", declaredSize: 3, fileName: "b.pdf", owner: "creator", status: "pending", failureMessage: null });
});

const body = new TextEncoder().encode("%PDF-1.7 test").buffer as ArrayBuffer;

async function put(itemId: string, token: string, data: ArrayBuffer, sha?: string) {
  return app.request(`/uploads/items/${itemId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf", "X-MF100-Sha256": sha ?? (await sha256Hex(data)) },
    body: data,
  });
}

describe("PUT /uploads/items/:itemId（F-04 / A-02）", () => {
  it("未認証・不正トークンは 401", async () => {
    expect((await app.request("/uploads/items/item1", { method: "PUT", body })).status).toBe(401);
    expect((await put("item1", "bogus", body)).status).toBe(401);
  });
  it("他人の項目は 404（存在を漏らさない）", async () => {
    const res = await put("item1", "valid:stranger", body);
    expect(res.status).toBe(404);
    expect(store.objects.size).toBe(0);
  });
  it("sha256 が一致すれば R2 に保存し Convex に verified を記録する", async () => {
    const res = await put("item1", "valid:creator", body);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ itemId: "item1", status: "verified", size: body.byteLength });
    expect(store.objects.has("works/w1/sessions/s1/0-a.pdf")).toBe(true);
    expect(gateway.calls).toEqual([`verified:item1:${body.byteLength}:${await sha256Hex(body)}`]);
  });
  it("sha256 不一致（転送途中の破損）は保存せず failed を記録し、原因を返す", async () => {
    const res = await put("item1", "valid:creator", body, "0".repeat(64));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "upload_failed" });
    expect(store.objects.size).toBe(0);
    expect(gateway.calls[0]).toMatch(/^failed:item1:/);
    expect(gateway.items.get("item1")?.status).toBe("failed");
  });
  it("申告サイズと不一致ならオブジェクトを削除して failed", async () => {
    const res = await put("item2", "valid:creator", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "size_mismatch" });
    expect(store.objects.size).toBe(0);
  });
  it("ヘッダー無しは 400", async () => {
    const res = await app.request("/uploads/items/item1", { method: "PUT", headers: { Authorization: "Bearer valid:creator" }, body });
    expect(res.status).toBe(400);
  });
  it("検証済みの項目には上書きできない（確定した版のファイルを無言で差し替えない）", async () => {
    await put("item1", "valid:creator", body);
    const res = await put("item1", "valid:creator", body);
    expect(res.status).toBe(409);
  });
});

describe("GET /files/:artifactId（§9.1 / A-11）", () => {
  beforeEach(async () => {
    await store.put("works/w1/rev1/a.pdf", body, { contentType: "application/pdf", sha256Hex: await sha256Hex(body) });
    gateway.artifacts.set("art1", { objectKey: "works/w1/rev1/a.pdf", mimeType: "application/pdf", fileName: "表紙.pdf", size: body.byteLength, viewers: ["reviewer"] });
  });
  it("許可された利用者にだけ配信し、キャッシュ禁止ヘッダーを付ける", async () => {
    const res = await app.request("/files/art1", { headers: { Authorization: "Bearer valid:reviewer" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Disposition")).toContain(encodeURIComponent("表紙.pdf"));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(body));
  });
  it("権限のない利用者は 403。剥奪後は即時に拒否される（署名 URL を発行しないため）", async () => {
    expect((await app.request("/files/art1", { headers: { Authorization: "Bearer valid:stranger" } })).status).toBe(403);
    gateway.artifacts.get("art1")!.viewers = [];
    expect((await app.request("/files/art1", { headers: { Authorization: "Bearer valid:reviewer" } })).status).toBe(403);
  });
  it("CORS は許可オリジンのみ", async () => {
    const ok = await app.request("/files/art1", { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET" } });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const ng = await app.request("/files/art1", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" } });
    expect(ng.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
