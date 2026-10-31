import { describe, expect, it } from "vitest";
import { checkRegisteredPlanInfoInText, normalizeRegisteredPlanInfo } from "../work/planInfo.ts";

describe("planInfo", () => {
  it("normalizeRegisteredPlanInfo trims and drops empty", () => {
    expect(normalizeRegisteredPlanInfo({ name: "  五月祭ステージ  ", number: null })).toEqual({
      name: "五月祭ステージ",
    });
    expect(normalizeRegisteredPlanInfo({ name: null, number: null })).toBeNull();
  });

  it("checkRegisteredPlanInfoInText flags missing fields per item", () => {
    const items = checkRegisteredPlanInfoInText("企画番号 E-12 の案内", {
      name: "五月祭ステージ",
      number: "E-12",
      venue: "本郷",
    });
    expect(items).toHaveLength(3);
    expect(items.find((i) => i.field === "number")?.ok).toBe(true);
    expect(items.find((i) => i.field === "name")?.ok).toBe(false);
    expect(items.find((i) => i.field === "venue")?.ok).toBe(false);
  });
});
