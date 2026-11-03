import { ConvexError } from "convex/values";
import { describe, expect, it } from "vite-plus/test";
import { genericErrorMessage } from "@/lib/errors";
import { failureText } from "./failureText";

describe("failureText（自動校正の失敗として記録する文言）", () => {
  it("画面で投げた日本語の文言はそのまま", () => {
    expect(failureText(new Error("画像を読み込めませんでした"))).toBe("画像を読み込めませんでした");
  });

  it("英語のメッセージは決まった文言のあとに元の文言を括弧で残す", () => {
    expect(failureText(new Error("The source image could not be decoded."))).toBe(
      "操作を完了できませんでした。もう一度お試しください。（The source image could not be decoded.）",
    );
  });

  it("ConvexError は利用者向けの文言とコードを残す", () => {
    const text = failureText(new ConvexError({ code: "revision_not_accepting" }));
    expect(text).toContain("この版は校正中ではありません");
    expect(text).toContain("revision_not_accepting");
  });

  it("Error でないものは決まった文言", () => {
    expect(failureText("boom")).toBe(genericErrorMessage());
  });
});
