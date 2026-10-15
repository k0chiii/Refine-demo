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

  it("制作物の内容の誤りは欄と理由を出す（一括登録では何件目かも）", () => {
    const err = (code: string, details: unknown) =>
      describeError(new ConvexError({ code, details: details as never })).message;
    expect(err("work_invalid", { field: "title", reason: "required" })).toBe(
      "名称を入力してください",
    );
    expect(err("work_invalid", { field: "creatorIds", reason: "required" })).toBe(
      "制作者を 1 人以上選んでください",
    );
    expect(err("work_invalid", { field: "approverId", reason: "unknown_user" })).toBe(
      "校了権限者に名簿にいない人が含まれています。一度サインインした人から選び直してください",
    );
    expect(err("work_invalid", { field: "title", reason: "too_long", max: 200 })).toBe(
      "名称は 200 文字までです",
    );
    expect(
      err("work_import_invalid", {
        reason: "row_invalid",
        index: 2,
        cause: "work_invalid",
        field: "creatorIds",
        causeReason: "required",
      }),
    ).toBe("3 件目を登録できません: 制作者を 1 人以上選んでください");
  });
});
