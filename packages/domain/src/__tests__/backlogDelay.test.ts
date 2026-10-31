import { describe, expect, it } from "vite-plus/test";
import { backlogDelayClass, backlogDelayTone } from "../dashboard/backlogDelay.ts";

const NOW = Date.parse("2026-10-31T12:00:00+09:00");
const day = 86_400_000;

describe("backlogDelayTone", () => {
  it("未到来は none", () => {
    expect(backlogDelayTone(NOW + day, NOW)).toBe("none");
  });
  it("1 日超〜2 日未満は oneDay", () => {
    expect(backlogDelayTone(NOW - day - 1, NOW)).toBe("oneDay");
  });
  it("2 日以上は twoDaysPlus", () => {
    expect(backlogDelayTone(NOW - 2 * day, NOW)).toBe("twoDaysPlus");
  });
});

describe("backlogDelayClass", () => {
  it("maps to CSS class names", () => {
    expect(backlogDelayClass("oneDay")).toBe("list__item--delay-1d");
    expect(backlogDelayClass("twoDaysPlus")).toBe("list__item--delay-2d");
    expect(backlogDelayClass("none")).toBe("");
  });
});
