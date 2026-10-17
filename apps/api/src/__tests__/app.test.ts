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
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Disposition")).toContain(encodeURIComponent("表紙.pdf"));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(body));
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

describe("フィードバックの添付 PUT / GET /feedback/files/:fileId", () => {
  beforeEach(() => {
    gateway.feedbackUploads.targets.set(
      "fb1",
      target({ keyPrefix: "feedback/w1/fb1/案.pdf", fileName: "案.pdf" }),
    );
    gateway.feedbackViewers.set("fb1", ["creator", "member"]);
  });
  const putFeedback = async (token: string, data: ArrayBuffer, sha?: string) =>
    app.request("/feedback/files/fb1", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf",
        "X-MF100-Sha256": sha ?? (await sha256Hex(data)),
      },
      body: data,
    });

  it("未認証は 401、他人の添付は 404、sha256 が合えば保存して verified", async () => {
    expect((await app.request("/feedback/files/fb1", { method: "PUT", body })).status).toBe(401);
    expect((await putFeedback("valid:member", body)).status).toBe(404);
    const res = await putFeedback("valid:creator", body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fileId: "fb1", status: "verified" });
    expect([...store.objects.keys()]).toEqual(["feedback/w1/fb1/案.pdf/attempts/att1"]);
    expect(gateway.feedbackUploads.calls).toEqual([
      "feedback-begin:fb1:att1",
      `feedback-complete:att1:${body.byteLength}:${await sha256Hex(body)}`,
    ]);
    // 検証済みには上書きできない
    expect((await putFeedback("valid:creator", body)).status).toBe(409);
  });

  it("sha256 不一致は保存せず failed を記録する", async () => {
    const res = await putFeedback("valid:creator", body, "0".repeat(64));
    expect(res.status).toBe(400);
    expect(store.objects.size).toBe(0);
    expect(gateway.feedbackUploads.targets.get("fb1")?.status).toBe("failed");
  });

  it("遅れた PUT は採用済みの添付の実体を変更できない（試行ごとに別キー）", async () => {
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
    const pendingB = putFeedback("valid:creator", enc("%B02"));
    await bArrived;
    expect((await putFeedback("valid:creator", enc("%A01"))).status).toBe(200);
    release();
    const resB = await pendingB;
    expect(resB.status).toBe(409);
    const adopted = gateway.feedbackUploads.targets.get("fb1")!.objectKey!;
    expect([...store.objects.keys()]).toEqual([adopted]);
    const res = await app.request("/feedback/files/fb1", {
      headers: { Authorization: "Bearer valid:member" },
    });
    expect(await res.text()).toBe("%A01");
  });

  it("見られる人にだけ配信し、/files と同じヘッダーを付ける", async () => {
    await putFeedback("valid:creator", body);
    const res = await app.request("/feedback/files/fb1", {
      headers: { Authorization: "Bearer valid:member" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toContain(encodeURIComponent("案.pdf"));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(body));
    expect(
      (
        await app.request("/feedback/files/fb1", {
          headers: { Authorization: "Bearer valid:stranger" },
        })
      ).status,
    ).toBe(403);
  });
});
