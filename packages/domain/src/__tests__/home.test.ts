import { describe, expect, it } from "vite-plus/test";
import type { WorkPermissionGrant } from "../acl/Permission.ts";
import {
  matchPerson,
  parseWorkCsv,
  parseWorkDeadline,
  resolveWorkImport,
  workCsvTemplate,
  WORK_IMPORT_MAX_ROWS,
} from "../work/bulkImport.ts";
import { revisionHeadsOf } from "../dashboard/workSummary.ts";
import { defaultSubmitTargetPolicy, isSubmitTarget, submitRouteFor } from "../work/submitTarget.ts";
import { endOfJstDate } from "../shared/deadline.ts";
import { makeRevision, makeWork, T0 } from "./fixtures.ts";

const none = { accepting: null };
const principal = (userId: string) => ({
  userId,
  isSystemAdmin: false,
  groupIds: [],
  orgPermissions: ["*"],
});
const editGrant = (principalId: string): WorkPermissionGrant => ({
  workId: "work1",
  principalType: "user",
  principalId,
  permission: "edit",
  grantedBy: "sysadmin",
  grantedAt: 0,
});

describe("版を提出する制作物（L-15）", () => {
  it("制作者で進行中なら出す。受付中の版があっても既定では出す", () => {
    const work = makeWork();
    const authz = { work, grants: [], principal: principal("creator") };
    expect(isSubmitTarget(authz, none)).toBe(true);
    expect(isSubmitTarget(authz, revisionHeadsOf([makeRevision()]))).toBe(true);
    expect(
      isSubmitTarget(authz, revisionHeadsOf([makeRevision()]), {
        ...defaultSubmitTargetPolicy,
        includeAccepting: false,
      }),
    ).toBe(false);
  });

  it("提出の権限が無い人・進行中でない制作物には出さない", () => {
    const work = makeWork();
    expect(isSubmitTarget({ work, grants: [], principal: principal("reviewer") }, none)).toBe(
      false,
    );
    expect(isSubmitTarget({ work, grants: [], principal: principal("approver") }, none)).toBe(
      false,
    );
    for (const lifecycle of ["draft", "on_hold", "finalized", "cancelled"] as const)
      expect(
        isSubmitTarget(
          { work: makeWork({ lifecycle }), grants: [], principal: principal("creator") },
          none,
        ),
      ).toBe(false);
  });

  it("edit の委任は既定では出さず、ポリシーで含められる（提出の権限はある）", () => {
    const authz = {
      work: makeWork(),
      grants: [editGrant("delegate")],
      principal: principal("delegate"),
    };
    expect(isSubmitTarget(authz, none)).toBe(false);
    expect(isSubmitTarget(authz, none, { ...defaultSubmitTargetPolicy, creatorOnly: false })).toBe(
      true,
    );
  });

  it("文章は文章エディタ、SNS は投稿の編集、ほかは版提出ダイアログ", () => {
    expect(submitRouteFor("document")).toBe("write");
    expect(submitRouteFor("sns")).toBe("post");
    expect(submitRouteFor("pdf")).toBe("upload");
    expect(submitRouteFor("image")).toBe("upload");
  });
});

const directory = [
  { id: "u1", name: "五月 めい", email: "mei@example.invalid" },
  { id: "u2", name: "駒場 校了", email: "approver@example.invalid" },
  { id: "u3", name: "同名 太郎", email: "a@example.invalid" },
  { id: "u4", name: "同名 太郎", email: "b@example.invalid" },
];
const csv = (lines: string[]) => lines.join("\n");
const header = "題名,年度,用途,区分,媒体,制作者,主管,校了権限者,納期,旧ID,機密区分,表記カテゴリ";

describe("制作物の一括登録（CSV）", () => {
  it("見出しで列を探し、行を登録の内容にする。担当者はメールか名前で照合する", () => {
    const parsed = parseWorkCsv(
      csv([
        header,
        "パンフレット,,来場者向け,印刷物,PDF,MEI@example.invalid、五月　めい,,駒場 校了,2026/11/14,PR-1,非公開,A1;A2",
        "",
        "告知,99,,SNS,SNS 投稿,mei@example.invalid,,approver@example.invalid,2026-11-20 18:00,,,",
      ]),
      { defaultYear: 100, now: T0 },
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((r) => r.line)).toEqual([2, 4]);
    const preview = resolveWorkImport(parsed, directory);
    expect(preview.ready).toBe(2);
    const [a, b] = preview.rows.map((r) => r.input!);
    expect(a).toMatchObject({
      title: "パンフレット",
      year: 100,
      mediaType: "pdf",
      creatorIds: ["u1"], // メールと名前で同じ人を書いても 1 人
      approverIds: ["u2"],
      deadlineAt: endOfJstDate("2026-11-14"),
      legacyId: "PR-1",
      confidentiality: "restricted",
      notationCategories: ["A1", "A2"],
    });
    expect(b).toMatchObject({ year: 99, mediaType: "sns", confidentiality: "normal" });
    expect(b!.deadlineAt).toBe(Date.UTC(2026, 10, 20, 9, 0));
  });

  it("見つからない・同名が複数・必須の欠け・読めない値は、取り込む前に行ごとに分かる", () => {
    const parsed = parseWorkCsv(
      csv([
        header,
        ",,,,ポスター,誰か,,同名 太郎,明日,,秘密,",
        "B,,,印刷物,PDF,u1@x,,mei@example.invalid;approver@example.invalid,2020-01-01,,,",
      ]),
      { defaultYear: 100, now: T0 },
    );
    const preview = resolveWorkImport(parsed, directory);
    expect(preview.ready).toBe(0);
    const [a, b] = preview.rows.map((r) => r.problems.join("／"));
    expect(a).toContain("制作物名がありません");
    expect(a).toContain("小ジャンル（または区分）がありません");
    expect(a).toContain("媒体「ポスター」が分かりません");
    expect(a).toContain("納期「明日」を日付として読めません");
    expect(a).toContain("機密区分「秘密」が分かりません");
    expect(a).toContain("制作者「誰か」が見つかりません");
    expect(a).toContain("2 人います");
    // 校了者は複数書ける（利用者決定 2026-10-18）。2 人とも名簿に当たる
    expect(preview.rows[1]!.approvers.map((m) => m.user?.id)).toEqual(["u1", "u2"]);
    expect(b).not.toContain("校了者");
    expect(b).toContain("納期が過ぎています");
  });

  it("旧ID が既存・CSV の中で重なる行は取り込まない", () => {
    const row = "X,,,印刷物,PDF,u1-name,,駒場 校了,,PR-1,,";
    const parsed = parseWorkCsv(
      csv([
        header,
        row.replace("u1-name", "五月 めい"),
        row.replace("u1-name", "五月 めい"),
        row.replace("PR-1", "PR-9").replace("u1-name", "五月 めい"),
      ]),
      {
        defaultYear: 100,
        now: T0,
      },
    );
    const preview = resolveWorkImport(parsed, directory, { existingLegacyIds: ["PR-9"] });
    expect(preview.rows.map((r) => r.input !== null)).toEqual([true, false, false]);
  });

  it("見出しが無い・必須の列が無い・行が多すぎるとファイル全体の問題になる", () => {
    expect(parseWorkCsv("a,b\n1,2", { defaultYear: 100, now: T0 }).errors[0]).toContain("見出し");
    const only = parseWorkCsv("題名\nA", { defaultYear: 100, now: T0 }).errors;
    expect(only[0]).toContain("制作者・校了者");
    expect(only[1]).toContain("小ジャンル");
    const many = [
      header,
      ...Array.from(
        { length: WORK_IMPORT_MAX_ROWS + 1 },
        (_, i) => `T${i},,,印刷物,PDF,五月 めい,,駒場 校了,,,,`,
      ),
    ];
    const parsed = parseWorkCsv(csv(many), { defaultYear: 100, now: T0 });
    expect(parsed.errors.join()).toContain(`${WORK_IMPORT_MAX_ROWS} 行まで`);
    expect(resolveWorkImport(parsed, directory).ready).toBe(0);
  });

  it("雛形はそのまま読める（見出しと記入例 1 行）", () => {
    const parsed = parseWorkCsv(workCsvTemplate(T0), { defaultYear: 100, now: T0 });
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.problems).toEqual([]);
  });

  it("納期と名前の照合の細部", () => {
    expect(parseWorkDeadline("")).toBeNull();
    expect(parseWorkDeadline("２０２６－１１－１４")).toBe(endOfJstDate("2026-11-14"));
    expect(parseWorkDeadline("2026-02-30")).toBeUndefined();
    expect(matchPerson(" 駒場  校了 ", directory).user?.id).toBe("u2");
    const miss = matchPerson("nobody@example.invalid", directory);
    expect(miss.user).toBeNull();
  });
});
