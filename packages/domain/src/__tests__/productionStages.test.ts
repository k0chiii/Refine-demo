import { describe, expect, it } from "vite-plus/test";
import {
  productionStageLabels,
  productionStages,
  type ProductionStage,
} from "../dashboard/productionStages.ts";

describe("productionStages（7 段階 ID）", () => {
  it("7 段階を固定順で持ち、ラベルにロール名は無い", () => {
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
    for (const id of productionStages) {
      const label = productionStageLabels[id as ProductionStage];
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/制作者|校正者|校了者/);
    }
    expect(productionStageLabels.finalized).toBe("校了");
    expect(productionStageLabels.submitted).toBe("入稿済み");
  });
});
