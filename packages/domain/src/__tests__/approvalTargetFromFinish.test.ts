import { describe, expect, it } from "vite-plus/test";
import { approvalTargetFromFinish } from "../work/approvalTargetFromFinish.ts";

describe("approvalTargetFromFinish", () => {
  const finish = Date.parse("2026-12-10T15:00:00+09:00");

  it("入稿準備日数を引く", () => {
    expect(approvalTargetFromFinish(finish, 3)).toBe(finish - 3 * 86_400_000);
  });

  it("負数や非数は 0 日扱い", () => {
    expect(approvalTargetFromFinish(finish, -2)).toBe(finish);
    expect(approvalTargetFromFinish(finish, Number.NaN)).toBe(finish);
  });
});
