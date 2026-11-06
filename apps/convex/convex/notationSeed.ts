import { importRules } from "@mf100/application";
import { internalMutation } from "./_generated/server";
import { createAppContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { SAMPLE_RULE_DRAFTS } from "./lib/notationSamples.ts";
import { principalOf } from "./lib/principal.ts";

/**
 * 表記ルールの初期投入（デモ版と同じルール。利用者指示 2026-10-18）。
 * 本番では Deploy の手動起動（seed_notation）から `convex run notationSeed:importSamples` で一度だけ流す。
 * 同じ ruleId のルールがあれば上書きせず飛ばすので、何度流しても増えない。記録上の実行者は最初のシステム管理者
 */
export const importSamples = internalMutation({
  args: {},
  handler: async (ctx) => {
    const admin = (await ctx.db.query("users").collect()).find((u) => u.isSystemAdmin);
    if (!admin)
      throw new Error("システム管理者がいません。管理者で一度サインインしてから流してください");
    return runUseCase(() =>
      importRules(createAppContext(ctx), principalOf(admin), {
        rules: SAMPLE_RULE_DRAFTS,
        notes: [],
        overwrite: false,
        reason: "初期データ（デモ版と同じ表記ルール）",
      }),
    );
  },
});
