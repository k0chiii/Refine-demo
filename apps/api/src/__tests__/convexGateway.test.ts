import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createConvexGateway } from "../adapters/convexGateway.ts";
import { GatewayError } from "../ports.ts";

const SECRET = "test-upload-secret-0123456789";

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

const gateway = (uploadSecret: string | undefined = SECRET) =>
  createConvexGateway({
    convexUrl: "https://example.convex.cloud",
    siteUrl: "https://example.convex.site/",
    uploadSecret,
  });

describe("Convex ゲートウェイ: 実体の転送はサービス境界へ", () => {
  it("利用者の JWT とサービスの秘密を付けて /internal を呼ぶ", async () => {
    const calls = stubFetch(() =>
      Response.json({
        attemptId: "a1",
        objectKey: "works/w/sessions/s/0-a.pdf/attempts/a1",
        mimeType: "application/pdf",
        declaredSize: null,
        fileName: "a.pdf",
      }),
    );
    const target = await gateway().itemUploads.begin("user-jwt", "item1");
    expect(target.attemptId).toBe("a1");
    expect(calls[0]!.url).toBe("https://example.convex.site/internal/uploads/items/begin");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer user-jwt");
    expect(headers["X-MF100-Service-Key"]).toBe(SECRET);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ itemId: "item1" });
  });

  it("業務の拒否（{code}）だけを GatewayError にする。秘密の不一致は 503 相当、通信の失敗は採否不明の Error", async () => {
    stubFetch(() =>
      Response.json({ code: "upload_session_not_open", details: { id: "s" } }, { status: 409 }),
    );
    await expect(
      gateway().feedbackUploads.complete("t", "a1", { size: 1, sha256: "x" }),
    ).rejects.toMatchObject({ code: "upload_session_not_open" });

    stubFetch(() => new Response("Not Found", { status: 404 }));
    await expect(gateway().itemUploads.fail("t", "a1", "m")).rejects.toMatchObject({
      code: "upload_service_unavailable",
    });

    stubFetch(() => new Response("bad gateway", { status: 502 }));
    const unknown = await gateway()
      .itemUploads.complete("t", "a1", { size: 1, sha256: "x" })
      .catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(Error);
    expect(unknown).not.toBeInstanceOf(GatewayError);
  });

  it("秘密が未設定なら呼ばずに upload_service_unavailable", async () => {
    const calls = stubFetch(() => Response.json({}));
    await expect(gateway("").itemUploads.begin("t", "item1")).rejects.toMatchObject({
      code: "upload_service_unavailable",
    });
    expect(calls).toHaveLength(0);
  });
});
