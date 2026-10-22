import { describe, expect, it } from "vite-plus/test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createAccessVerifier } from "../adapters/accessVerifier.ts";

describe("optional Cloudflare Access gate", () => {
  it("requires a signed JWT for the configured team and audience", async () => {
    const key = await generateKeyPair("ES256");
    const jwk = await exportJWK(key.publicKey);
    const verify = createAccessVerifier(
      "test-team",
      "staging",
      createLocalJWKSet({ keys: [{ ...jwk, kid: "test" }] }),
    );
    const sign = (audience: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: "test" })
        .setIssuer("https://test-team.cloudflareaccess.com")
        .setAudience(audience)
        .setExpirationTime("1m")
        .sign(key.privateKey);
    const request = (token: string) =>
      new Request("https://api.invalid/health", { headers: { "Cf-Access-Jwt-Assertion": token } });
    expect(await verify(new Request("https://api.invalid/health"))).toBe(false);
    expect(await verify(request(await sign("staging")))).toBe(true);
    expect(await verify(request(await sign("production")))).toBe(false);
    expect(await verify(request("forged"))).toBe(false);
    expect(() => createAccessVerifier("other.invalid/path", "audience")).toThrow();
  });
});
