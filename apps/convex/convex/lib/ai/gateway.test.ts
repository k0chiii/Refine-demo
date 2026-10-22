import { describe, expect, it } from "vite-plus/test";
import { gatewayOptions } from "./gateway.ts";
describe("AI gateway privacy", () => {
  it("uses direct provider by default and disables body logs/cache when enabled", () => {
    expect(gatewayOptions(undefined)).toEqual({});
    expect(
      gatewayOptions("https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic"),
    ).toMatchObject({
      defaultHeaders: { "cf-aig-collect-log": "false", "cf-aig-skip-cache": "true" },
    });
    expect(() => gatewayOptions("https://attacker.invalid/v1/a/b/anthropic")).toThrow();
    expect(() => gatewayOptions("http://gateway.ai.cloudflare.com/v1/a/b/anthropic")).toThrow();
  });
});
