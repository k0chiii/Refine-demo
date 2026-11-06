import { describe, expect, it } from "vite-plus/test";
import { hasOAuthReturnCode } from "./workspace";

describe("hasOAuthReturnCode", () => {
  it("OAuth の code があるとき true", () => {
    expect(hasOAuthReturnCode("?code=abc")).toBe(true);
    expect(hasOAuthReturnCode("code=abc&state=1")).toBe(true);
  });

  it("code が無いとき false", () => {
    expect(hasOAuthReturnCode("")).toBe(false);
    expect(hasOAuthReturnCode("?")).toBe(false);
    expect(hasOAuthReturnCode("?foo=1")).toBe(false);
  });
});
