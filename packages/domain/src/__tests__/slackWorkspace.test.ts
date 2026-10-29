import { describe, expect, it } from "vite-plus/test";
import { validateSlackWorkspace } from "../index.ts";

const invalid = (field: "name" | "teamId") =>
  expect.objectContaining({ code: "slack_workspace_invalid", details: { field } });

describe("Slack のワークスペースの登録", () => {
  it("名前は前後の空白を除き、team_id は前後の空白を除いて大文字にそろえる", () => {
    expect(validateSlackWorkspace({ name: "  五月祭  ", teamId: " t0123abcd " })).toEqual({
      name: "五月祭",
      teamId: "T0123ABCD",
    });
    expect(validateSlackWorkspace({ name: "MF", teamId: "TAB" })).toEqual({
      name: "MF",
      teamId: "TAB",
    });
  });

  it("全角で打った team_id も半角にそろえる", () => {
    expect(validateSlackWorkspace({ name: "五月祭", teamId: "Ｔ０１２３ＡＢＣＤ" }).teamId).toBe(
      "T0123ABCD",
    );
  });

  it("名前は 1〜80 文字", () => {
    expect(validateSlackWorkspace({ name: "あ".repeat(80), teamId: "T01" }).name).toHaveLength(80);
    for (const name of ["", "   ", "あ".repeat(81)])
      expect(() => validateSlackWorkspace({ name, teamId: "T01" })).toThrow(invalid("name"));
  });

  it("team_id は T で始まる英数字（T のほか 2 文字以上）", () => {
    for (const teamId of ["", "T", "T1", "U0123ABCD", "C0123ABCD", "T-0123", "T0123 ABCD", "0123"])
      expect(() => validateSlackWorkspace({ name: "五月祭", teamId })).toThrow(invalid("teamId"));
  });
});
