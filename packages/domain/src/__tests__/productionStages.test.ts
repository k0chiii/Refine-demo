import { describe, expect, it } from "vite-plus/test";
import { productionStages } from "../dashboard/productionStages.ts";

describe("productionStages（7 段階 ID）", () => {
  it("7 段階を固定順で持つ", () => {
    expect(productionStages).toHaveLength(7);
    expect(productionStages).toEqual([
      "unsubmitted",
      "in_review",
      "applying",
      "awaiting_finalize",
      "awaiting_translation",
      "finalized",
      "submitted",
    ]);
  });
});
