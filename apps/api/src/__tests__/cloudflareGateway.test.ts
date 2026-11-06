import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createCloudflareCleanupGateway } from "../adapters/cloudflareCleanupGateway.ts";
import { createCloudflareGateway } from "../adapters/cloudflareGateway.ts";
import { createCloudflareProcessingClient } from "../adapters/processingClient.ts";
import { GatewayError } from "../ports.ts";

const SECRET = "test-upload-secret-0123456789";
const SITE = "https://cf.invalid";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  });
  return calls;
}
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;
const bodyOf = (init: RequestInit) => JSON.parse(init.body as string);

const gateway = (uploadSecret: string | undefined = SECRET) =>
  createCloudflareGateway({ siteUrl: `${SITE}/`, uploadSecret, requestId: "req-1" });

const target = {
  attemptId: "a1",
  objectKey: "works/w/sessions/s/0-a.pdf/attempts/a1",
  mimeType: "application/pdf",
  declaredSize: null,
  fileName: "a.pdf",
};

describe("Cloudflare ゲートウェイ: 実体の転送は /f/<module>:<fn> へ", () => {
  it("利用者の JWT とサービスの秘密を付けて submissions:beginUpload を呼び、{ value } を剥がす", async () => {
    const calls = stubFetch(() => Response.json({ value: target }));
    expect(await gateway().itemUploads.begin("user-jwt", "item1")).toEqual(target);
    expect(calls[0]!.url).toBe(`${SITE}/f/submissions:beginUpload`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(headersOf(calls[0]!.init)).toMatchObject({
      Authorization: "Bearer user-jwt",
      "X-MF100-Service-Key": SECRET,
      "X-Request-ID": "req-1",
    });
    expect(bodyOf(calls[0]!.init)).toEqual({ itemId: "item1" });
  });

  it("Convex の /internal の各経路は、同じ意味の Cloudflare 関数に対応する", async () => {
    const calls = stubFetch(() => Response.json({ value: { ...target, adopted: false } }));
    const g = gateway();
    await g.itemUploads.resume!("t", "a1");
    await g.itemUploads.complete("t", "a1", { size: 3, sha256: "x", pdfCompatible: true });
    await g.itemUploads.fail("t", "a1", "m");
    await g.commentUploads.begin("t", "f1");
    await g.commentUploads.complete("t", "a2", { size: 4, sha256: "y" });
    await g.commentUploads.fail("t", "a2", "m2");
    await g.commentThumbs.begin("t", "f1");
    await g.commentThumbs.complete("t", "f1", { size: 5, mimeType: "image/webp" });
    expect(calls.map((c) => [c.url.slice(SITE.length), bodyOf(c.init)])).toEqual([
      ["/f/submissions:resumeUpload", { attemptId: "a1" }],
      [
        "/f/submissions:completeUpload",
        { attemptId: "a1", size: 3, sha256: "x", pdfCompatible: true },
      ],
      ["/f/submissions:failUpload", { attemptId: "a1", message: "m" }],
      ["/f/commentFiles:beginFileUpload", { fileId: "f1" }],
      ["/f/commentFiles:completeFileUpload", { attemptId: "a2", size: 4, sha256: "y" }],
      ["/f/commentFiles:failFileUpload", { attemptId: "a2", message: "m2" }],
      ["/f/commentFiles:beginThumbUpload", { fileId: "f1" }],
      ["/f/commentFiles:completeThumbUpload", { fileId: "f1", size: 5, mimeType: "image/webp" }],
    ]);
    // 添付に resume は無い（Convex 版と同じ）
    expect("resume" in g.commentUploads).toBe(false);
  });

  it("認可は利用者の JWT だけで尋ねる（サービスの秘密は付けない）", async () => {
    const access = { objectKey: "k", mimeType: "image/png", fileName: "a.png", size: 1 };
    const calls = stubFetch(() => Response.json({ value: access, reads: [] }));
    expect(await gateway().authorizeArtifact("jwt", "art1")).toEqual(access);
    expect(await gateway().authorizeCommentFile("jwt", "f1", "thumb")).toEqual(access);
    expect(calls.map((c) => [c.url.slice(SITE.length), bodyOf(c.init)])).toEqual([
      ["/f/artifacts:authorizeAccess", { artifactId: "art1" }],
      ["/f/commentFiles:authorizeFile", { fileId: "f1", variant: "thumb" }],
    ]);
    for (const c of calls) {
      expect(headersOf(c.init).Authorization).toBe("Bearer jwt");
      expect(headersOf(c.init)["X-MF100-Service-Key"]).toBeUndefined();
    }
  });

  it("業務の拒否（{code, details}）だけを GatewayError にする。通信の失敗は採否不明の Error", async () => {
    stubFetch(() =>
      Response.json({ code: "upload_session_not_open", details: { id: "s" } }, { status: 409 }),
    );
    await expect(
      gateway().commentUploads.complete("t", "a1", { size: 1, sha256: "x" }),
    ).rejects.toMatchObject({ code: "upload_session_not_open", details: { id: "s" } });

    stubFetch(() => Response.json({ code: "forbidden", details: {} }, { status: 403 }));
    await expect(gateway().authorizeArtifact("t", "a")).rejects.toMatchObject({
      code: "forbidden",
    });

    // 引数の形の不正は Convex の bad_request（400）にそろえる
    stubFetch(() =>
      Response.json({ code: "invalid_args", details: { issues: [] } }, { status: 400 }),
    );
    await expect(gateway().itemUploads.begin("t", "i")).rejects.toMatchObject({
      code: "bad_request",
    });

    stubFetch(() => new Response("bad gateway", { status: 502 }));
    const unknown = await gateway()
      .itemUploads.complete("t", "a1", { size: 1, sha256: "x" })
      .catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(Error);
    expect(unknown).not.toBeInstanceOf(GatewayError);
  });

  it("秘密の不一致（関数ごと 404 function_not_found）は upload_service_unavailable。認可の query には当てはめない", async () => {
    stubFetch(() => Response.json({ code: "function_not_found", details: {} }, { status: 404 }));
    await expect(gateway().itemUploads.fail("t", "a1", "m")).rejects.toMatchObject({
      code: "upload_service_unavailable",
    });
    await expect(gateway().authorizeArtifact("t", "a")).rejects.toMatchObject({
      code: "function_not_found",
    });
  });

  it("秘密が未設定なら呼ばずに upload_service_unavailable", async () => {
    const calls = stubFetch(() => Response.json({ value: {} }));
    await expect(gateway("").itemUploads.begin("t", "item1")).rejects.toMatchObject({
      code: "upload_service_unavailable",
    });
    expect(calls).toHaveLength(0);
  });

  it("試行の払い出しが壊れていれば採否不明の Error", async () => {
    stubFetch(() => Response.json({ value: { attemptId: "a", objectKey: "" } }));
    await expect(gateway().itemUploads.begin("t", "i")).rejects.toThrow(/invalid target/);
  });
});

describe("Cloudflare 清掃ゲートウェイ", () => {
  it("MF100_CLEANUP_SECRET の Bearer で submissions:listOrphanObjects / markObjectsPurged を呼ぶ", async () => {
    const calls = stubFetch((url) =>
      Response.json({
        value: url.endsWith("listOrphanObjects")
          ? [{ itemId: "i1", objectKey: "k1", extraObjectKeys: ["k2"] }]
          : 1,
      }),
    );
    const cleanup = createCloudflareCleanupGateway(`${SITE}/`, "c".repeat(16));
    expect(await cleanup.listOrphans(50)).toEqual([
      { itemId: "i1", objectKey: "k1", extraObjectKeys: ["k2"] },
    ]);
    expect(await cleanup.markPurged(["i1"])).toBe(1);
    expect(calls.map((c) => [c.url.slice(SITE.length), bodyOf(c.init)])).toEqual([
      ["/f/submissions:listOrphanObjects", { limit: 50 }],
      ["/f/submissions:markObjectsPurged", { itemIds: ["i1"] }],
    ]);
    expect(headersOf(calls[0]!.init).Authorization).toBe(`Bearer ${"c".repeat(16)}`);
  });

  it("失敗は例外（cleanup は次回に再試行する）", async () => {
    stubFetch(() => Response.json({ code: "function_not_found", details: {} }, { status: 404 }));
    await expect(
      createCloudflareCleanupGateway(SITE, "c".repeat(16)).listOrphans(1),
    ).rejects.toThrow();
  });
});

describe("Cloudflare 処理クライアント", () => {
  it("processing:create / get を利用者の JWT で呼び、{ value } を剥がす", async () => {
    const calls = stubFetch((url) =>
      Response.json({ value: url.endsWith("create") ? "job1" : { id: "job1", state: "queued" } }),
    );
    const client = createCloudflareProcessingClient(SITE, "jwt");
    expect(
      await client.create({ kind: "figma", options: {}, consentToProcessing: true } as never),
    ).toBe("job1");
    expect(await client.get("job1")).toMatchObject({ state: "queued" });
    expect(calls.map((c) => [c.url.slice(SITE.length), bodyOf(c.init)])).toEqual([
      ["/f/processing:create", { kind: "figma", options: {}, consentToProcessing: true }],
      ["/f/processing:get", { jobId: "job1" }],
    ]);
    expect(headersOf(calls[0]!.init).Authorization).toBe("Bearer jwt");
  });

  it("拒否は GatewayError（platform が状態に直す）", async () => {
    stubFetch(() => Response.json({ code: "forbidden", details: {} }, { status: 403 }));
    await expect(createCloudflareProcessingClient(SITE, "jwt").get("j")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
