import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createBackend, createCleanup } from "../backend.ts";
import { backendSiteUrl, type Bindings } from "../env.ts";
import { handleRequest } from "../index.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const CF = "https://cf-switch.invalid";
const CONVEX_SITE = "https://convex-switch.invalid";
const base = {
  CONVEX_URL: "https://convex-switch-cloud.invalid",
  CONVEX_SITE_URL: CONVEX_SITE,
  ALLOWED_ORIGINS: "http://localhost:5173",
  MF100_UPLOAD_SECRET: "test-upload-secret-0123456789",
  ASSETS: {},
} as unknown as Bindings;
const cloudflare = { ...base, BACKEND: "cloudflare", CLOUDFLARE_SITE_URL: `${CF}/` } as Bindings;

const calls: string[] = [];
function stubFetch(respond: (url: string) => Response | Promise<Response>) {
  calls.length = 0;
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return respond(url);
  });
}

describe("BACKEND の切り替え", () => {
  it("未設定は convex。URL は Convex の SITE を指す", () => {
    expect(backendSiteUrl(base)).toBe(CONVEX_SITE);
    expect(backendSiteUrl({ ...base, BACKEND: "convex" })).toBe(CONVEX_SITE);
  });

  it("cloudflare は CLOUDFLARE_SITE_URL（末尾の / なし）を指し、無ければ Convex に落とさず投げる", () => {
    expect(backendSiteUrl(cloudflare)).toBe(CF);
    expect(() => backendSiteUrl({ ...base, BACKEND: "cloudflare" })).toThrow(/CLOUDFLARE_SITE_URL/);
  });

  it("BACKEND=cloudflare の gateway は Cloudflare の /f/ を呼び、convex は Convex を呼ぶ", async () => {
    stubFetch(() => Response.json({ value: {} }));
    await createBackend(cloudflare, "r").gateway.authorizeArtifact("jwt", "a1");
    expect(calls).toEqual([`${CF}/f/artifacts:authorizeAccess`]);

    stubFetch(() => Response.json({ status: "error", errorMessage: "x" }));
    await createBackend(base, "r")
      .gateway.authorizeArtifact("jwt", "a1")
      .catch(() => undefined);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^https:\/\/convex-switch-cloud\.invalid\//);
  });

  it("清掃も BACKEND に従う", async () => {
    stubFetch(() => Response.json({ value: [] }));
    await createCleanup(cloudflare, "c".repeat(16)).listOrphans(1);
    expect(calls).toEqual([`${CF}/f/submissions:listOrphanObjects`]);

    stubFetch(() => Response.json({ items: [] }));
    await createCleanup(base, "c".repeat(16)).listOrphans(1);
    expect(calls).toEqual([`${CONVEX_SITE}/internal/upload-orphans?limit=1`]);
  });

  it("handleRequest: JWT は CLOUDFLARE_SITE_URL の issuer・JWKS で検証し、認可は Cloudflare が決める", async () => {
    const key = await generateKeyPair("ES256");
    const jwk = { ...(await exportJWK(key.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
    const sign = (issuer: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: "k1" })
        .setIssuer(issuer)
        .setAudience("convex")
        .setSubject("user1")
        .setExpirationTime("1m")
        .sign(key.privateKey);
    stubFetch((url) =>
      url === `${CF}/.well-known/jwks.json`
        ? Response.json({ keys: [jwk] })
        : Response.json({ code: "forbidden", details: { artifactId: "a1" } }, { status: 403 }),
    );
    const request = (token: string) =>
      handleRequest(
        new Request("https://api.invalid/files/a1", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        cloudflare,
        {} as ExecutionContext,
      );

    const ok = await request(await sign(CF));
    expect(ok.status).toBe(403);
    expect(await ok.json()).toMatchObject({ code: "forbidden" });
    expect(calls).toContain(`${CF}/f/artifacts:authorizeAccess`);

    // 別の issuer（Convex の SITE）で署名したものは通らない
    calls.length = 0;
    const rejected = await request(await sign(CONVEX_SITE));
    expect(rejected.status).toBe(401);
    expect(calls).not.toContain(`${CF}/f/artifacts:authorizeAccess`);
  });
});
