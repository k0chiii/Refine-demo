import { ConvexError } from "convex/values";
import { describe, expect, it } from "vite-plus/test";
import { describeError, messageForCode } from "./errors";

describe("describeError（UI_M3E §35 W-02）", () => {
  it("英語のメッセージ（ライブラリ・ネットワーク）はそのまま見せない", () => {
    const message = describeError(new TypeError("Failed to fetch")).message;
    expect(message).not.toBe("");
    expect(message).not.toContain("Failed to fetch");
  });

  it("画面で投げた日本語の文言はそのまま出す", () => {
    expect(describeError(new Error("まだ確認できていないファイルがあります")).message).toBe(
      "まだ確認できていないファイルがあります",
    );
  });

  it("知らないコードは、問い合わせの手がかりとしてコードを添える", () => {
    expect(describeError(new ConvexError({ code: "something_new" })).message).toContain(
      "something_new",
    );
  });

  it("グラフィック制作物の提出で起こる失敗は、決まった案内を出す（コードを見せるだけにしない）", () => {
    for (const code of ["revision_no_reviewable_file", "upload_file_too_large"])
      expect(describeError(new ConvexError({ code })).message).not.toContain(code);
    expect(messageForCode("upload_file_too_large")).not.toContain("コード");
  });

  it("Slack のワークスペースの登録の失敗は、決まった案内を出し、名前と team_id のどちらが悪いかで分ける", () => {
    const message = (code: string, details: Record<string, string>) =>
      describeError(new ConvexError({ code, details })).message;
    const name = message("slack_workspace_invalid", { field: "name" });
    const teamId = message("slack_workspace_invalid", { field: "teamId" });
    const duplicate = message("slack_workspace_duplicate", { teamId: "T0123ABCD" });
    for (const m of [name, teamId, duplicate]) expect(m).not.toContain("slack_workspace");
    expect(name).not.toBe(teamId);
  });

  it("自動校正の再試行の上限は、権限の不足と分けて上限の回数を出す", () => {
    const forbidden = describeError(new ConvexError({ code: "forbidden" })).message;
    const exhausted = describeError(
      new ConvexError({ code: "proofread_retry_exhausted", details: { attempts: 5, max: 4 } }),
    ).message;
    expect(exhausted).not.toBe(forbidden);
    expect(exhausted).toContain("4");
  });

  it("通知の設定の失敗のうち Slack のメールアドレスの形の誤りは、ほかの欄と分ける", () => {
    const message = (details: Record<string, string>) =>
      describeError(new ConvexError({ code: "notification_prefs_invalid", details })).message;
    expect(message({ field: "slackEmail" })).not.toBe(message({ field: "channels" }));
    expect(message({ field: "slackEmail" })).not.toContain("notification_prefs");
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
      "制作物名を入力してください",
    );
    expect(err("work_invalid", { field: "creatorIds", reason: "required" })).toBe(
      "制作者を 1 人以上選んでください",
    );
    expect(err("work_invalid", { field: "approverIds", reason: "unknown_user" })).toBe(
      "校了する人に名簿にいない人が含まれています。一度サインインした人から選び直してください",
    );
    // 制作者を校了者にした誤りは、汎用の文言ではなく欄に即した文言になる
    expect(err("work_invalid", { field: "approverIds", reason: "creator_is_approver" })).not.toBe(
      err("work_invalid", { field: "approverIds", reason: "no_such_reason" }),
    );
    expect(err("work_invalid", { field: "title", reason: "too_long", max: 200 })).toBe(
      "制作物名は 200 文字までです",
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
