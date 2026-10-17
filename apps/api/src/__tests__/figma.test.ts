import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../app.ts";
import { createFigmaClient } from "../adapters/figmaClient.ts";
import { FigmaApiError } from "../ports.ts";
import {
  FakeFigma,
  FakeGateway,
  MemoryStore,
  fakeVerifier,
  sha256Hex,
  type FakeUploadTarget,
} from "./fakes.ts";

const ORIGIN = "http://localhost:5173";
const KEY = "AbCdEfGhIjKl";
let gateway: FakeGateway;
let store: MemoryStore;
let figma: FakeFigma;
let app: ReturnType<typeof createApp>;

const png = (seed: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, seed + 1, seed + 2]);
const item = (over: Partial<FakeUploadTarget>): FakeUploadTarget => ({
  keyPrefix: "works/w1/sessions/s1/0-figma.png",
  mimeType: "image/png",
  declaredSize: null,
  fileName: "figma-12-34.png",
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
  figma = new FakeFigma();
  figma.files.set(KEY, {
    version: "987",
    lastModified: "2026-10-17T01:02:03Z",
    nodes: new Map([
      ["12:34", { name: "ホーム（スマホ）", box: { width: 402, height: 874 }, png: png(1) }],
      ["56:78", { name: "ホーム（PC）", box: { width: 1440, height: 2000 }, png: png(9) }],
      ["99:1", { name: "描けない", box: null, png: null }],
    ]),
  });
  app = createApp({
    verifier: fakeVerifier,
    gateway,
    store,
    allowedOrigins: [ORIGIN],
    figma,
    figmaScale: 2,
  });
  gateway.itemUploads.targets.set("i1", item({}));
  gateway.itemUploads.targets.set(
    "i2",
    item({ keyPrefix: "works/w1/sessions/s1/1-figma.png", fileName: "figma-56-78.png" }),
  );
});

const post = (token: string, body: unknown) =>
  app.request("/figma/import", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Figma の取り込み（POST /figma/import。FG-05）", () => {
  it("トークンが無ければ status は無効、import は 503「未設定」", async () => {
    const off = createApp({ verifier: fakeVerifier, gateway, store, allowedOrigins: [ORIGIN] });
    const st = await off.request("/figma/status", {
      headers: { Authorization: "Bearer valid:creator" },
    });
    expect(await st.json()).toEqual({ enabled: false });
    const res = await off.request("/figma/import", {
      method: "POST",
      headers: { Authorization: "Bearer valid:creator", "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ itemId: "i1", fileKey: KEY, nodeId: "12:34" }] }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "figma_not_configured" });
    const on = await app.request("/figma/status", {
      headers: { Authorization: "Bearer valid:creator" },
    });
    expect(await on.json()).toEqual({ enabled: true });
  });
  it("未認証は 401、形が違えば 400", async () => {
    expect((await app.request("/figma/import", { method: "POST" })).status).toBe(401);
    expect((await post("valid:creator", { items: [] })).status).toBe(400);
    expect((await post("valid:creator", { items: [{ itemId: 1 }] })).status).toBe(400);
  });
  it("1 ファイル分を nodes と images の 1 回ずつで取り、PUT と同じ道（試行 → R2 → 採用）で verified にし、ノード名・版・大きさを添える", async () => {
    const res = await post("valid:creator", {
      items: [
        { itemId: "i1", fileKey: KEY, nodeId: "12:34" },
        { itemId: "i2", fileKey: KEY, nodeId: "56:78" },
      ],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(json.items).toEqual([
      { itemId: "i1", status: "verified", failureMessage: null, nodeName: "ホーム（スマホ）" },
      { itemId: "i2", status: "verified", failureMessage: null, nodeName: "ホーム（PC）" },
    ]);
    expect(figma.calls.filter((c) => c.startsWith("nodes:"))).toEqual([`nodes:${KEY}:12:34,56:78`]);
    expect(figma.calls.filter((c) => c.startsWith("images:"))).toEqual([
      `images:${KEY}:12:34,56:78:2`,
    ]);
    const t1 = gateway.itemUploads.targets.get("i1")!;
    expect(t1.status).toBe("verified");
    expect(t1.objectKey).toBe("works/w1/sessions/s1/0-figma.png/attempts/att1");
    expect(t1.figma).toEqual({
      nodeName: "ホーム（スマホ）",
      box: { width: 402, height: 874 },
      figmaVersion: "987",
      lastModified: "2026-10-17T01:02:03Z",
    });
    expect([...store.objects.keys()].sort()).toEqual([
      "works/w1/sessions/s1/0-figma.png/attempts/att1",
      "works/w1/sessions/s1/1-figma.png/attempts/att2",
    ]);
    expect(store.objects.get(t1.objectKey!)!.contentType).toBe("image/png");
    expect(gateway.itemUploads.calls[1]).toBe(
      `complete:att1:${png(1).byteLength}:${await sha256Hex(png(1).slice().buffer as ArrayBuffer)}`,
    );
  });
  it("429 は Retry-After を 1 回だけ待って再試行する", async () => {
    figma.rateLimitNext = 2;
    const waits: number[] = [];
    const { importFigmaFrames } = await import("../figmaImport.ts");
    const results = await importFigmaFrames(
      {
        figma,
        uploads: gateway.itemUploads,
        store,
        scale: 2,
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
      "valid:creator",
      [{ itemId: "i1", fileKey: KEY, nodeId: "12:34" }],
    );
    expect(waits).toEqual([2000]);
    expect(results[0]).toMatchObject({ status: "verified" });
    // 2 回目も 429 なら失敗にして理由を残す
    figma.rateLimitNext = 1;
    const again = await importFigmaFrames(
      {
        figma,
        uploads: gateway.itemUploads,
        store,
        scale: 2,
        sleep: async () => {
          figma.rateLimitNext = 1;
        },
      },
      "valid:creator",
      [{ itemId: "i2", fileKey: KEY, nodeId: "56:78" }],
    );
    expect(again[0]).toMatchObject({ status: "failed" });
    expect(again[0]!.failureMessage).toMatch(/回数制限/);
    expect(gateway.itemUploads.targets.get("i2")?.status).toBe("failed");
  });
  it("無いノード・描けないノード・権限の無いファイル・不正な URL は項目ごとに failed と理由（他の項目は続く）", async () => {
    gateway.itemUploads.targets.set("i3", item({ keyPrefix: "k3" }));
    gateway.itemUploads.targets.set("i4", item({ keyPrefix: "k4" }));
    const res = await post("valid:creator", {
      items: [
        { itemId: "i1", fileKey: KEY, nodeId: "12:34" },
        { itemId: "i2", fileKey: KEY, nodeId: "1:999" },
        { itemId: "i3", fileKey: KEY, nodeId: "99:1" },
        { itemId: "i4", fileKey: "bad key", nodeId: "1:2" },
      ],
    });
    const json = (await res.json()) as {
      items: Array<{ itemId: string; status: string; failureMessage: string }>;
    };
    expect(json.items.map((i) => i.status)).toEqual(["verified", "failed", "failed", "failed"]);
    expect(json.items[1]!.failureMessage).toMatch(/見つかりません/);
    expect(json.items[2]!.failureMessage).toMatch(/画像にできません/);
    expect(json.items[3]!.failureMessage).toMatch(/解釈できません/);
    expect(gateway.itemUploads.targets.get("i2")?.status).toBe("failed");
    expect(store.objects.size).toBe(1);

    figma.forbidden = true;
    gateway.itemUploads.targets.set("i5", item({ keyPrefix: "k5" }));
    const res2 = await post("valid:creator", {
      items: [{ itemId: "i5", fileKey: KEY, nodeId: "12:34" }],
    });
    const j2 = (await res2.json()) as { items: Array<{ failureMessage: string }> };
    expect(j2.items[0]!.failureMessage).toMatch(/権限/);
  });
  it("他人の項目は Convex が拒否し、R2 には何も残らない", async () => {
    const res = await post("valid:stranger", {
      items: [{ itemId: "i1", fileKey: KEY, nodeId: "12:34" }],
    });
    const json = (await res.json()) as { items: Array<{ status: string }> };
    expect(json.items[0]!.status).toBe("failed");
    expect(store.objects.size).toBe(0);
    expect(gateway.itemUploads.targets.get("i1")?.status).toBe("pending");
  });
});

describe("Figma クライアント（fetch の形。実際の API は呼ばない）", () => {
  it("X-Figma-Token を付けて nodes / images を呼び、応答を要約する。429 は Retry-After を読む", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.includes("/files/")) {
        return Response.json({
          version: "1",
          lastModified: "2026-10-17T00:00:00Z",
          nodes: {
            "12:34": {
              document: { name: "ホーム", absoluteBoundingBox: { width: 402, height: 874 } },
            },
            "1:2": null,
          },
        });
      }
      if (url.includes("/images/"))
        return Response.json({
          err: null,
          images: { "12:34": "https://cdn.invalid/a.png", "1:2": null },
        });
      if (url.includes("limited"))
        return new Response("", { status: 429, headers: { "Retry-After": "7" } });
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;
    const client = createFigmaClient("secret-token", fetchImpl);
    const nodes = await client.getNodes("AbCdEfGhIjKl", ["12:34", "1:2"]);
    expect(nodes.version).toBe("1");
    expect(nodes.nodes.get("12:34")).toEqual({ name: "ホーム", box: { width: 402, height: 874 } });
    expect(nodes.nodes.has("1:2")).toBe(false);
    expect(calls[0]!.url).toBe(
      "https://api.figma.com/v1/files/AbCdEfGhIjKl/nodes?ids=12%3A34%2C1%3A2&depth=1",
    );
    expect(calls[0]!.headers["X-Figma-Token"]).toBe("secret-token");
    const images = await client.renderImages("AbCdEfGhIjKl", ["12:34", "1:2"], 2);
    expect(calls[1]!.url).toContain(
      "/v1/images/AbCdEfGhIjKl?ids=12%3A34%2C1%3A2&scale=2&format=png",
    );
    expect(images.get("12:34")).toBe("https://cdn.invalid/a.png");
    expect(images.get("1:2")).toBeNull();
    expect((await client.download("https://cdn.invalid/a.png")).byteLength).toBe(3);
    // 画像の取得にはトークンを付けない
    expect(calls[2]!.headers["X-Figma-Token"]).toBeUndefined();
    await expect(client.download("https://cdn.invalid/limited")).rejects.toMatchObject({
      status: 429,
      retryAfterSec: 7,
    } satisfies Partial<FigmaApiError>);
  });
});
