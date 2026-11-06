import { internal } from "./_generated/api";
import { describe, expect, it } from "vite-plus/test";
import { createCast, createHarness } from "../test/harness";
import { SAMPLE_RULE_DRAFTS } from "./lib/notationSamples";

describe("Convex 統合: 表記ルールの初期投入", () => {
  it("システム管理者がいれば全件を入れ、流し直しても増えない", async () => {
    const t = createHarness();
    await createCast(t);
    const first = await t.mutation(internal.notationSeed.importSamples, {});
    expect(first).toMatchObject({ created: SAMPLE_RULE_DRAFTS.length, errors: [] });
    const again = await t.mutation(internal.notationSeed.importSamples, {});
    expect(again).toMatchObject({ created: 0, skipped: SAMPLE_RULE_DRAFTS.length });
    const rules = await t.run((ctx) => ctx.db.query("notationRules").collect());
    expect(rules).toHaveLength(SAMPLE_RULE_DRAFTS.length);
  });
  it("システム管理者がいなければ入れない", async () => {
    const t = createHarness();
    await expect(t.mutation(internal.notationSeed.importSamples, {})).rejects.toThrow();
  });
});
