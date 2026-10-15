import { ConvexError } from "convex/values";
import { describe, expect, it } from "vite-plus/test";
import { describeError } from "./errors";

describe("describeError（UI_M3E §35 W-02）", () => {
  it("英語のメッセージ（ライブラリ・ネットワーク）は決まった日本語にする", () => {
    expect(describeError(new TypeError("Failed to fetch")).message).toBe(
      "操作を完了できませんでした。もう一度お試しください。",
    );
  });

  it("画面で投げた日本語の文言はそのまま出す", () => {
    expect(describeError(new Error("まだ確認できていないファイルがあります")).message).toBe(
      "まだ確認できていないファイルがあります",
    );
  });

  it("知らないコードは決まった文言にコードを添える", () => {
    expect(describeError(new ConvexError({ code: "something_new" })).message).toBe(
      "操作を完了できませんでした。もう一度お試しください（コード: something_new）。",
    );
  });

  it("状態の変更の失敗には今の状態を入れる", () => {
    expect(
      describeError(
        new ConvexError({
          code: "work_invalid_lifecycle_transition",
          details: { from: "cancelled", to: "active" },
        }),
      ).message,
    ).toBe("この制作物は今「中止」なので、「進行中」にはできません");
    expect(
      describeError(
        new ConvexError({
          code: "comment_invalid_resolution_transition",
          details: { from: "resolved", to: "edited" },
        }),
      ).message,
    ).toBe("このコメントは今「反映済み」なので、訂正できません");
  });

  it("ルールの誤りはどの欄かを出す", () => {
    expect(
      describeError(
        new ConvexError({
          code: "notation_rule_invalid",
          details: { errors: ["統一表記が空です"] },
        }),
      ).message,
    ).toBe("ルールの内容を確かめてください: 統一表記が空です");
  });
});
