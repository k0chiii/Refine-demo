import { describe, expect, it } from "vitest";
import { ensureAuthSiteUrl } from "./authEnv.ts";

describe("ensureAuthSiteUrl", () => {
  it("SITE_URL が無いとき FRONTEND_URL から埋める", () => {
    const env: NodeJS.ProcessEnv = { FRONTEND_URL: "https://mf100-refine.pages.dev/" };
    ensureAuthSiteUrl(env);
    expect(env.SITE_URL).toBe("https://mf100-refine.pages.dev");
    expect(env.FRONTEND_URL).toBe("https://mf100-refine.pages.dev/");
  });

  it("FRONTEND_URL が無いとき SITE_URL から埋める", () => {
    const env: NodeJS.ProcessEnv = { SITE_URL: "https://mf100-refine.pages.dev" };
    ensureAuthSiteUrl(env);
    expect(env.FRONTEND_URL).toBe("https://mf100-refine.pages.dev");
  });

  it("両方あるときは触らない", () => {
    const env: NodeJS.ProcessEnv = {
      FRONTEND_URL: "https://a.example",
      SITE_URL: "https://b.example",
    };
    ensureAuthSiteUrl(env);
    expect(env.FRONTEND_URL).toBe("https://a.example");
    expect(env.SITE_URL).toBe("https://b.example");
  });

  it("どちらも無いときは何もしない", () => {
    const env: NodeJS.ProcessEnv = {};
    ensureAuthSiteUrl(env);
    expect(env.SITE_URL).toBeUndefined();
    expect(env.FRONTEND_URL).toBeUndefined();
  });
});
