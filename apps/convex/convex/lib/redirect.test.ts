import { describe, expect, it } from "vite-plus/test";
import { resolveRedirectTo } from "./redirect.ts";

describe("ログイン後の遷移先（redirectTo）の検証", () => {
  const base = "https://app.example";

  it("「/」1 個で始まる相対パスは FRONTEND_URL の下に解決する", () => {
    expect(resolveRedirectTo("/", base)).toBe("https://app.example/");
    expect(resolveRedirectTo("/works/123?tab=info#x", base)).toBe(
      "https://app.example/works/123?tab=info#x",
    );
  });

  it("同じ origin の絶対 URL は許可する", () => {
    expect(resolveRedirectTo("https://app.example/works", base)).toBe("https://app.example/works");
    expect(resolveRedirectTo("https://app.example", base)).toBe("https://app.example/");
  });

  it("前方一致だけ同じ別ホスト（https://app.example.attacker.test/）は拒否する", () => {
    expect(() => resolveRedirectTo("https://app.example.attacker.test/", base)).toThrow(
      /Invalid redirectTo/,
    );
    expect(() => resolveRedirectTo("https://app.example:8443/", base)).toThrow();
    expect(() => resolveRedirectTo("https://app.example@evil.test/", base)).toThrow();
    expect(() => resolveRedirectTo("http://app.example/", base)).toThrow();
  });

  it("スキーム相対・バックスラッシュ・javascript: などは拒否する", () => {
    for (const bad of [
      "//evil.test",
      "//evil.test/path",
      "/\\evil.test",
      "\\\\evil.test",
      "/\tevil",
      "javascript:alert(1)",
      "data:text/html,x",
      "evil.test",
      "",
      " https://app.example/",
    ])
      expect(() => resolveRedirectTo(bad, base), bad).toThrow();
  });

  it("FRONTEND_URL にパスがあれば、そのパスの境界の下だけ許可する", () => {
    const sub = "https://host.example/app";
    expect(resolveRedirectTo("/works", sub)).toBe("https://host.example/app/works");
    expect(resolveRedirectTo("https://host.example/app", sub)).toBe("https://host.example/app");
    expect(resolveRedirectTo("https://host.example/app/x", sub)).toBe("https://host.example/app/x");
    expect(() => resolveRedirectTo("https://host.example/application", sub)).toThrow();
    expect(() => resolveRedirectTo("https://host.example/other", sub)).toThrow();
  });
});
