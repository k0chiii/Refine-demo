import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../app.ts";
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

const target = (over: Partial<FakeUploadTarget>): FakeUploadTarget => ({
  keyPrefix: "works/w1/sessions/s1/0-a.pdf",
  mimeType: "application/pdf",
  declaredSize: null,
  fileName: "a.pdf",
  owner: "creator",
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
  gateway.itemUploads.targets.set("item1", target({}));
  gateway.itemUploads.targets.set(
    "item2",
    target({ keyPrefix: "works/w1/sessions/s1/1-b.pdf", declaredSize: 3, fileName: "b.pdf" }),
  );
});

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const body = enc("%PDF-1.7 test");
const text = (key: string) => new TextDecoder().decode(store.objects.get(key)?.bytes);

async function put(itemId: string, token: string, data: ArrayBuffer, sha?: string) {
  return app.request(`/uploads/items/${itemId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/pdf",
      "X-MF100-Sha256": sha ?? (await sha256Hex(data)),
    },
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
  it("sha256 が一致すれば、この試行だけのキーに保存し Convex に採用を求める", async () => {
    const res = await put("item1", "valid:creator", body);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ itemId: "item1", status: "verified", size: body.byteLength });
    const adopted = gateway.itemUploads.targets.get("item1")!.objectKey!;
    expect(adopted).toBe("works/w1/sessions/s1/0-a.pdf/attempts/att1");
    expect([...store.objects.keys()]).toEqual([adopted]);
    expect(gateway.itemUploads.calls).toEqual([
      "begin:item1:att1",
      `complete:att1:${body.byteLength}:${await sha256Hex(body)}`,
    ]);
  });
  it("sha256 不一致（転送途中の破損）は保存せず failed を記録し、原因を返す", async () => {
    const res = await put("item1", "valid:creator", body, "0".repeat(64));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "upload_failed" });
    expect(store.objects.size).toBe(0);
    expect(gateway.itemUploads.calls[1]).toMatch(/^fail:att1:/);
    expect(gateway.itemUploads.targets.get("item1")?.status).toBe("failed");
  });
  it("申告サイズと不一致なら自分の試行のオブジェクトを削除して failed", async () => {
    const res = await put("item2", "valid:creator", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "size_mismatch" });
    expect(store.objects.size).toBe(0);
    expect(gateway.itemUploads.attempts.get("att1")?.state).toBe("discarded");
  });
  it("ヘッダー無しは 400", async () => {
    const res = await app.request("/uploads/items/item1", {
      method: "PUT",
      headers: { Authorization: "Bearer valid:creator" },
      body,
    });
    expect(res.status).toBe(400);
  });
  it("検証済みの項目には上書きできない（確定した版のファイルを無言で差し替えない）", async () => {
    await put("item1", "valid:creator", body);
    const res = await put("item1", "valid:creator", body);
    expect(res.status).toBe(409);
  });

  it("P1 再現: 確認を通過した 2 つの PUT のうち遅れた B は、A の検証・提出確定後でも確定した実体を変更できない", async () => {
    // B が先に受付確認を通過し、R2 への書込み直前で止まる
    let arrived!: () => void;
    let release!: () => void;
    const bArrived = new Promise<void>((r) => (arrived = r));
    const held = new Promise<void>((r) => (release = r));
    let first = true;
    store.beforeWrite = async () => {
      if (!first) return;
      first = false;
      arrived();
      await held;
    };
    const pendingB = put("item1", "valid:creator", enc("%B02"));
    await bArrived;

    // A が検証され、提出が確定する（Artifact は A の実体を参照）
    const resA = await put("item1", "valid:creator", enc("%A01"));
    expect(resA.status).toBe(200);
    gateway.confirm("item1", "art1", ["reviewer"]);
    const confirmedKey = gateway.artifacts.get("art1")!.objectKey;
    expect(text(confirmedKey)).toBe("%A01");

    // 遅れた B の書込みが終わる → 受付終了で 409。確定した実体は %A01 のまま、B の実体は B 自身が消す
    release();
    const resB = await pendingB;
    expect(resB.status).toBe(409);
    expect(await resB.json()).toMatchObject({ code: "upload_session_not_open" });
    expect(text(confirmedKey)).toBe("%A01");
    expect([...store.objects.keys()]).toEqual([confirmedKey]);
    const delivered = await app.request("/files/art1", {
      headers: { Authorization: "Bearer valid:reviewer" },
    });
    expect(await delivered.text()).toBe("%A01");
    // 試行の記録: A は採用、B は破棄（補償は B の試行にしか作用しない）
    const states = [...gateway.itemUploads.attempts.values()].map((a) => [a.objectKey, a.state]);
    expect(states).toEqual([
      ["works/w1/sessions/s1/0-a.pdf/attempts/att1", "discarded"],
      ["works/w1/sessions/s1/0-a.pdf/attempts/att2", "adopted"],
    ]);
  });

  it("採否が分からない失敗（Convex への通信断）では自分の実体も消さない（採用済みかもしれないため。未採用なら清掃が消す）", async () => {
    gateway.itemUploads.failNextCompleteWithNetworkError = true;
    const res = await put("item1", "valid:creator", body);
    expect(res.status).toBe(500);
    expect([...store.objects.keys()]).toEqual(["works/w1/sessions/s1/0-a.pdf/attempts/att1"]);
    expect(gateway.itemUploads.calls.some((c) => c.startsWith("fail:"))).toBe(false);
  });
});

describe("Illustrator・InDesign の提出と配信（利用者指示 2026-10-19）", () => {
  const put = async (itemId: string, data: ArrayBuffer, over: Record<string, string> = {}) =>
    app.request(`/uploads/items/${itemId}`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer valid:creator",
        "Content-Type": "application/octet-stream",
        "X-MF100-Sha256": await sha256Hex(data),
        ...over,
      },
      body: data,
    });
  const addItem = (id: string, fileName: string, mimeType: string) =>
    gateway.itemUploads.targets.set(
      id,
      target({ keyPrefix: `works/w1/sessions/s1/${id}`, fileName, mimeType, declaredSize: null }),
    );
  const pad = (s: string, n: number) => enc(" ".repeat(n) + s);

  it(".ai は R2 に置いた実体の先頭を見て、PDF 互換かを採用の要求に添える", async () => {
    addItem("ai-pdf", "poster.ai", "application/illustrator");
    addItem("ai-ps", "old.ai", "application/illustrator");
    expect((await put("ai-pdf", enc("%PDF-1.6\n%AI9 private data"))).status).toBe(200);
    expect((await put("ai-ps", enc("%!PS-Adobe-3.0 EPSF-3.0"))).status).toBe(200);
    expect(gateway.itemUploads.completeMetas).toEqual([
      { pdfCompatible: true },
      { pdfCompatible: false },
    ]);
  });
  it("PDF の見出しが先頭の少し後ろにあっても互換。先頭 1024 バイトの外なら互換としない", async () => {
    addItem("near", "a.ai", "application/illustrator");
    addItem("far", "b.ai", "application/illustrator");
    await put("near", pad("%PDF-1.5", 200));
    await put("far", pad("%PDF-1.5", 1100));
    expect(gateway.itemUploads.completeMetas).toEqual([
      { pdfCompatible: true },
      { pdfCompatible: false },
    ]);
  });
  it("先頭の確認は R2 の範囲読み 1 回だけ（全体を読まない）。.ai 以外・コメントの添付では読まない", async () => {
    addItem("ai", "poster.ai", "application/illustrator");
    addItem("indd", "poster.indd", "application/x-indesign");
    await put("ai", enc("%PDF-1.6 x"));
    expect(store.gets).toEqual([
      { key: "works/w1/sessions/s1/ai/attempts/att1", range: { offset: 0, length: 1024 } },
    ]);
    store.gets.length = 0;
    await put("indd", enc("INDD binary"));
    await put("item1", body);
    expect(store.gets).toEqual([]);
    expect(gateway.itemUploads.completeMetas.slice(1)).toEqual([{}, {}]);

    gateway.commentUploads.targets.set(
      "cf-ai",
      target({ keyPrefix: "comments/w1/cf/x.ai", fileName: "x.ai" }),
    );
    gateway.commentViewers.set("cf-ai", { viewers: ["creator"], cacheable: false });
    await app.request("/comment-files/cf-ai", {
      method: "PUT",
      headers: {
        Authorization: "Bearer valid:creator",
        "X-MF100-Sha256": await sha256Hex(body),
      },
      body,
    });
    expect(store.gets).toEqual([]);
    expect(gateway.commentUploads.completeMetas).toEqual([{}]);
  });
  it("上限（100 MB）を超える本文は、読み始める前に 413 と理由で断る。試行も始めない", async () => {
    addItem("huge", "huge.indd", "application/x-indesign");
    const res = await put("huge", enc("x"), { "Content-Length": "150000000" });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "file_too_large", limit: 100_000_000 });
    expect(gateway.itemUploads.calls).toEqual([]);
    expect(store.objects.size).toBe(0);
  });
  it("数十 MB の原本は断らない（上限内の申告は先へ進む）", async () => {
    addItem("big", "poster.indd", "application/x-indesign");
    const res = await put("big", enc("x"), { "Content-Length": "60000000" });
    expect(res.status).not.toBe(413);
  });

  describe("配信", () => {
    const serve = async (id: string, fileName: string, mimeType: string, data: ArrayBuffer) => {
      const key = `works/w1/rev1/${id}`;
      await store.put(key, data, { contentType: mimeType, sha256Hex: await sha256Hex(data) });
      gateway.artifacts.set(id, {
        objectKey: key,
        mimeType,
        fileName,
        size: data.byteLength,
        viewers: ["reviewer"],
      });
      return app.request(`/files/${id}`, { headers: { Authorization: "Bearer valid:reviewer" } });
    };
    it(".ai / .indd は MIME と元のファイル名つきの attachment で返す（開かず保存させる）", async () => {
      const ai = await serve("a1", "表紙 案.ai", "application/illustrator", enc("%PDF-1.6"));
      expect(ai.headers.get("Content-Type")).toBe("application/illustrator");
      const disposition = ai.headers.get("Content-Disposition")!;
      expect(disposition.startsWith("attachment;")).toBe(true);
      expect(decodeURIComponent(disposition.split("UTF-8''")[1]!)).toBe("表紙 案.ai");
      expect(ai.headers.get("X-Content-Type-Options")).toBe("nosniff");

      const indd = await serve("a2", "poster.INDD", "application/x-indesign", enc("INDD"));
      expect(indd.headers.get("Content-Type")).toBe("application/x-indesign");
      expect(indd.headers.get("Content-Disposition")!.startsWith("attachment;")).toBe(true);
    });
    it("PDF・画像は従来どおり inline", async () => {
      const pdf = await serve("p1", "a.pdf", "application/pdf", body);
      expect(pdf.headers.get("Content-Disposition")!.startsWith("inline;")).toBe(true);
      const png = await serve("p2", "a.png", "image/png", enc("png"));
      expect(png.headers.get("Content-Disposition")!.startsWith("inline;")).toBe(true);
    });
    it("範囲取得（206）の応答も attachment のまま", async () => {
      await serve("a3", "poster.ai", "application/illustrator", enc("%PDF-1.6 body"));
      const ranged = await app.request("/files/a3", {
        headers: { Authorization: "Bearer valid:reviewer", Range: "bytes=0-3" },
      });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("Content-Disposition")!.startsWith("attachment;")).toBe(true);
    });
  });
});

describe("GET /files/:artifactId（§9.1 / A-11）", () => {
  beforeEach(async () => {
    await store.put("works/w1/rev1/a.pdf", body, {
      contentType: "application/pdf",
      sha256Hex: await sha256Hex(body),
    });
    gateway.artifacts.set("art1", {
      objectKey: "works/w1/rev1/a.pdf",
      mimeType: "application/pdf",
      fileName: "表紙.pdf",
      size: body.byteLength,
      viewers: ["reviewer"],
    });
  });
  it("許可された利用者にだけ配信し、キャッシュ禁止ヘッダーを付ける", async () => {
    const res = await app.request("/files/art1", {
      headers: { Authorization: "Bearer valid:reviewer" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Cache-Control")).not.toMatch(/max-age|immutable/);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("ETag")).toMatch(/^".+"$/);
    expect(res.headers.get("Content-Disposition")).toContain(encodeURIComponent("表紙.pdf"));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(body));
  });
  describe("Range / ETag", () => {
    const get = (headers: Record<string, string>, token = "valid:reviewer") =>
      app.request("/files/art1", { headers: { Authorization: `Bearer ${token}`, ...headers } });
    const total = body.byteLength;

    it("範囲を 206 で返し、R2 の範囲読みで取る（全体を読まない）", async () => {
      store.gets.length = 0;
      const res = await get({ Range: "bytes=1-4" });
      expect(res.status).toBe(206);
      expect(res.headers.get("Content-Range")).toBe(`bytes 1-4/${total}`);
      expect(res.headers.get("Content-Length")).toBe("4");
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(body).slice(1, 5));
      expect(store.gets).toEqual([{ key: "works/w1/rev1/a.pdf", range: { offset: 1, length: 4 } }]);
    });
    it("末尾までの指定・末尾 n バイト・実体を超える終わりを実体に収める", async () => {
      const open = await get({ Range: "bytes=3-" });
      expect(open.status).toBe(206);
      expect(open.headers.get("Content-Range")).toBe(`bytes 3-${total - 1}/${total}`);
      const suffix = await get({ Range: "bytes=-5" });
      expect(suffix.headers.get("Content-Range")).toBe(`bytes ${total - 5}-${total - 1}/${total}`);
      expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(new Uint8Array(body).slice(-5));
      const over = await get({ Range: `bytes=0-${total + 1000}` });
      expect(over.headers.get("Content-Range")).toBe(`bytes 0-${total - 1}/${total}`);
    });
    it("実体の外の範囲は 416（Content-Range: bytes */size）", async () => {
      const res = await get({ Range: `bytes=${total}-` });
      expect(res.status).toBe(416);
      expect(res.headers.get("Content-Range")).toBe(`bytes */${total}`);
    });
    it("複数範囲・単位違い・書式不正は範囲として扱わず、全体を 200 で返す", async () => {
      for (const range of ["bytes=0-1,3-4", "items=0-1", "bytes=a-b"]) {
        const res = await get({ Range: range });
        expect(res.status).toBe(200);
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(body));
      }
    });
    it("範囲でも認可は通る: 権限のない利用者は 403、剥奪後も 403", async () => {
      expect((await get({ Range: "bytes=0-1" }, "valid:stranger")).status).toBe(403);
      gateway.artifacts.get("art1")!.viewers = [];
      expect((await get({ Range: "bytes=0-1" })).status).toBe(403);
    });
    it("If-None-Match が ETag に当たれば 304（本体なし）。権限のない人には 304 を返さない", async () => {
      const etag = (await get({})).headers.get("ETag")!;
      const hit = await get({ "If-None-Match": etag });
      expect(hit.status).toBe(304);
      expect(hit.headers.get("ETag")).toBe(etag);
      expect(await hit.text()).toBe("");
      expect((await get({ "If-None-Match": '"other"' })).status).toBe(200);
      expect((await get({ "If-None-Match": etag }, "valid:stranger")).status).toBe(403);
      gateway.artifacts.get("art1")!.viewers = [];
      expect((await get({ "If-None-Match": etag })).status).toBe(403);
    });
    it("If-Range が今の ETag と違えば範囲を無視して全体を返す", async () => {
      const etag = (await get({})).headers.get("ETag")!;
      expect((await get({ Range: "bytes=0-1", "If-Range": etag })).status).toBe(206);
      expect((await get({ Range: "bytes=0-1", "If-Range": '"stale"' })).status).toBe(200);
    });
    it("R2 の操作を減らす: 範囲・If-Range つき範囲・全体の取得は HEAD なしの 1 回、304 の確認は HEAD だけ", async () => {
      const etag = (await get({})).headers.get("ETag")!;
      const count = async (headers: Record<string, string>) => {
        store.gets.length = 0;
        store.heads = 0;
        const res = await get(headers);
        await res.arrayBuffer();
        return { status: res.status, gets: store.gets.length, heads: store.heads };
      };
      expect(await count({})).toEqual({ status: 200, gets: 1, heads: 0 });
      expect(await count({ Range: "bytes=1-4" })).toEqual({ status: 206, gets: 1, heads: 0 });
      expect(await count({ Range: "bytes=1-4", "If-Range": etag })).toEqual({
        status: 206,
        gets: 1,
        heads: 0,
      });
      expect(await count({ "If-None-Match": etag })).toEqual({ status: 304, gets: 0, heads: 1 });
      // 範囲が実体の外: R2 が断るので HEAD で大きさを確かめて 416
      expect(await count({ Range: `bytes=${total}-` })).toEqual({
        status: 416,
        gets: 1,
        heads: 1,
      });
      // If-Range が違う: 範囲を捨てて全体を取り直す（まれ。実体は上書きされないので通常は起きない）
      expect(await count({ Range: "bytes=1-4", "If-Range": '"stale"' })).toEqual({
        status: 200,
        gets: 2,
        heads: 0,
      });
    });
    it("範囲の書式を R2 に渡す形に読み替える（大きさを知らずに）", async () => {
      const spec = async (range: string) => {
        store.gets.length = 0;
        await (await get({ Range: range })).arrayBuffer();
        return store.gets[0]?.range;
      };
      expect(await spec("bytes=2-5")).toEqual({ offset: 2, length: 4 });
      expect(await spec("bytes=2-")).toEqual({ offset: 2 });
      expect(await spec("bytes=-3")).toEqual({ suffix: 3 });
      // 終わりが始めより前・複数範囲・単位違いは範囲として扱わない（全体の取得）
      expect(await spec("bytes=5-2")).toBeUndefined();
      expect(await spec("bytes=0-1,3-4")).toBeUndefined();
    });
    it("CORS: Range などを許可し、Content-Range などをブラウザに見せる", async () => {
      const pre = await app.request("/files/art1", {
        method: "OPTIONS",
        headers: {
          Origin: ORIGIN,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization,range,if-none-match",
        },
      });
      const allowed = (pre.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase();
      for (const h of ["authorization", "range", "if-none-match", "if-range"])
        expect(allowed).toContain(h);
      const res = await app.request("/files/art1", {
        headers: { Authorization: "Bearer valid:reviewer", Origin: ORIGIN, Range: "bytes=0-1" },
      });
      const exposed = (res.headers.get("Access-Control-Expose-Headers") ?? "").toLowerCase();
      for (const h of ["content-range", "accept-ranges", "content-length", "etag"])
        expect(exposed).toContain(h);
    });
  });
  it("権限のない利用者は 403。剥奪後は即時に拒否される（署名 URL を発行しないため）", async () => {
    expect(
      (await app.request("/files/art1", { headers: { Authorization: "Bearer valid:stranger" } }))
        .status,
    ).toBe(403);
    gateway.artifacts.get("art1")!.viewers = [];
    expect(
      (await app.request("/files/art1", { headers: { Authorization: "Bearer valid:reviewer" } }))
        .status,
    ).toBe(403);
  });
  it("CORS は許可オリジンのみ", async () => {
    const ok = await app.request("/files/art1", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET" },
    });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const ng = await app.request("/files/art1", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" },
    });
    expect(ng.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
