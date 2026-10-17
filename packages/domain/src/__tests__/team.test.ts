import { describe, expect, it } from "vite-plus/test";
import {
  matchTeam,
  parseTeamCsv,
  parseWorkCsv,
  planTeamImport,
  resolveWorkImport,
  sortTeams,
  sortWorks,
  TEAM_NAME_MAX,
  teamCsvTemplate,
  teamPath,
  validateTeam,
  workBelongsToTeam,
  workCsvTemplate,
  type Team,
} from "../index.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const t = (
  id: string,
  name: string,
  kind: Team["kind"],
  order: number,
  parentId?: string,
): Team => ({
  id,
  name,
  kind,
  order,
  ...(parentId ? { parentId } : {}),
  updatedAt: 0,
  updatedBy: "u_admin",
});

// 並び順をわざと崩して渡す
const teams: Team[] = [
  t("design", "デザイン担当", "team", 1, "pr"),
  t("soumu", "総務局", "bureau", 2),
  t("web", "Web担当", "team", 3, "pr"),
  t("pr", "広報局", "bureau", 1),
  t("sns", "SNS担当", "team", 2, "pr"),
  t("kikaku", "企画局", "bureau", 3),
  t("shogai", "渉外担当", "team", 1, "soumu"),
  t("design2", "デザイン担当", "team", 2, "soumu"),
];

describe("組織（局 › 担当）の検証", () => {
  it("名前を整え、並び順を省略すると同じ親の最後にする", () => {
    expect(validateTeam({ name: "  企画担当 ", kind: "team", parentId: "kikaku" }, teams)).toEqual({
      name: "企画担当",
      kind: "team",
      parentId: "kikaku",
      order: 1,
    });
    expect(validateTeam({ name: "新しい担当", kind: "team", parentId: "pr" }, teams).order).toBe(4);
    expect(validateTeam({ name: "財務局", kind: "bureau" }, teams)).toEqual({
      name: "財務局",
      kind: "bureau",
      order: 4,
    });
    expect(validateTeam({ name: "財務局", kind: "bureau", order: 0 }, teams).order).toBe(0);
  });

  it("名前が空・長すぎる、担当に局が無い、局に親がある、親が局でないものは拒否する", () => {
    expect(() => validateTeam({ name: " ", kind: "bureau" }, teams)).toThrow(code("team_invalid"));
    expect(() =>
      validateTeam({ name: "あ".repeat(TEAM_NAME_MAX + 1), kind: "bureau" }, teams),
    ).toThrow(code("team_invalid"));
    expect(() => validateTeam({ name: "担当", kind: "team" }, teams)).toThrow(code("team_invalid"));
    expect(() => validateTeam({ name: "担当", kind: "team", parentId: "nope" }, teams)).toThrow(
      code("team_invalid"),
    );
    expect(() => validateTeam({ name: "担当", kind: "team", parentId: "design" }, teams)).toThrow(
      code("team_invalid"),
    );
    expect(() => validateTeam({ name: "局", kind: "bureau", parentId: "pr" }, teams)).toThrow(
      code("team_invalid"),
    );
    expect(() => validateTeam({ name: "局", kind: "bureau", order: 1.5 }, teams)).toThrow(
      code("team_invalid"),
    );
  });

  it("同じ親の中の同じ名前は重複（自分は除く）。別の局なら同じ名前でもよい", () => {
    expect(() => validateTeam({ name: "ＳＮＳ担当", kind: "team", parentId: "pr" }, teams)).toThrow(
      code("team_duplicate"),
    );
    expect(() => validateTeam({ name: "広報局", kind: "bureau" }, teams)).toThrow(
      code("team_duplicate"),
    );
    // 自分を除いた兄弟の最後（並び順を保つのはユースケース側で今の値を渡す）
    expect(
      validateTeam({ name: "SNS担当", kind: "team", parentId: "pr" }, teams, "sns").order,
    ).toBe(4);
    expect(validateTeam({ name: "SNS担当", kind: "team", parentId: "soumu" }, teams).name).toBe(
      "SNS担当",
    );
  });
});

describe("並び・経路・照合", () => {
  it("局を並び順で、それぞれの直後にその局の担当を並び順で", () => {
    expect(sortTeams(teams).map((x) => x.id)).toEqual([
      "pr",
      "design",
      "sns",
      "web",
      "soumu",
      "shogai",
      "design2",
      "kikaku",
    ]);
  });

  it("経路は「局 › 担当」、局は名前だけ、知らない ID は null", () => {
    expect(teamPath("design", teams)).toBe("広報局 › デザイン担当");
    expect(teamPath("pr", teams)).toBe("広報局");
    expect(teamPath("nope", teams)).toBeNull();
  });

  it("「局 › 担当」「局/担当」「局／担当」「局>担当」・担当の名前・局の名前で引ける", () => {
    for (const ref of [
      "広報局 › デザイン担当",
      "広報局/デザイン担当",
      "広報局／デザイン担当",
      "広報局>デザイン担当",
      " 広報局 ＞ デザイン担当 ",
    ])
      expect(matchTeam(ref, teams)).toEqual({ kind: "ok", team: teams[0] });
    expect(matchTeam("sns担当", teams)).toMatchObject({ kind: "ok", team: { id: "sns" } });
    expect(matchTeam("企画局", teams)).toMatchObject({ kind: "ok", team: { id: "kikaku" } });
    expect(matchTeam("総務局/デザイン担当", teams)).toMatchObject({ team: { id: "design2" } });
  });

  it("同じ名前の担当が複数あれば候補を返し、無ければ見つからない", () => {
    const m = matchTeam("デザイン担当", teams);
    expect(m.kind).toBe("ambiguous");
    expect(m.kind === "ambiguous" && m.candidates.map((x) => x.id)).toEqual(["design", "design2"]);
    expect(matchTeam("広報局/渉外担当", teams)).toEqual({ kind: "not_found" });
    expect(matchTeam("どこか", teams)).toEqual({ kind: "not_found" });
    expect(matchTeam("", teams)).toEqual({ kind: "not_found" });
  });
});

describe("制作物一覧の担当での絞り込み・並べ替え", () => {
  const w = (
    title: string,
    ownerTeamId: string | null,
    productionTeamIds: string[],
    acceptingDeadlineAt: number | null = null,
    deadlineAt: number | null = null,
  ) => ({ title, ownerTeamId, productionTeamIds, acceptingDeadlineAt, deadlineAt });
  const works = [
    w("パンフレット", "design", ["design"], 30, 300),
    w("公式サイト", "web", ["web", "design"], 10, null),
    w("ポスター", null, [], null, 100),
    w("局の案内", "pr", [], 20, 200),
    w("Instagram", "sns", ["sns"], null, null),
    w("消えた担当", "deleted", ["deleted"], 40, 50),
    w("渉外資料", "shogai", ["shogai", "deleted"], null, 400),
  ];
  const titles = (list: readonly { title: string }[]) => list.map((x) => x.title);
  const only = (axis: "owner" | "production", id: string) =>
    titles(works.filter((x) => workBelongsToTeam(x, teams, axis, id)));

  it("担当を選ぶとその担当、局を選ぶと局の直下とその局の担当の制作物", () => {
    expect(only("owner", "design")).toEqual(["パンフレット"]);
    expect(only("owner", "pr")).toEqual(["パンフレット", "公式サイト", "局の案内", "Instagram"]);
    expect(only("production", "design")).toEqual(["パンフレット", "公式サイト"]);
    expect(only("production", "soumu")).toEqual(["渉外資料"]);
    expect(only("owner", "kikaku")).toEqual([]);
    expect(only("owner", "deleted")).toEqual([]);
  });

  it("校正の締切・納期は近い順で無いものは後ろ、同じなら 校正の締切 → 題名", () => {
    expect(titles(sortWorks(works, teams, "accepting"))).toEqual([
      "公式サイト",
      "局の案内",
      "パンフレット",
      "消えた担当",
      "Instagram",
      "ポスター",
      "渉外資料",
    ]);
    expect(titles(sortWorks(works, teams, "deadline"))).toEqual([
      "消えた担当",
      "ポスター",
      "局の案内",
      "パンフレット",
      "渉外資料",
      "公式サイト",
      "Instagram",
    ]);
    expect(titles(sortWorks(works, teams, "title"))).toEqual(
      titles(works).sort((a, b) => a.localeCompare(b, "ja")),
    );
  });

  it("担当で並べると組織の並び順（局 → その局の担当）。制作担当はいちばん上の担当、未設定は後ろ", () => {
    expect(titles(sortWorks(works, teams, "owner"))).toEqual([
      "局の案内",
      "パンフレット",
      "Instagram",
      "公式サイト",
      "渉外資料",
      "消えた担当",
      "ポスター",
    ]);
    expect(titles(sortWorks(works, teams, "production"))).toEqual([
      "公式サイト",
      "パンフレット",
      "Instagram",
      "渉外資料",
      "局の案内",
      "消えた担当",
      "ポスター",
    ]);
  });
});

describe("組織の CSV", () => {
  it("見出しで列を探し、担当が空の行は局だけを定める。読めない行は理由を返す", () => {
    const parsed = parseTeamCsv(
      [
        "組織の一覧",
        "順,局名,担当名",
        "1,広報局,デザイン担当",
        "",
        ",総務局,",
        "x,広報局,SNS担当",
        ",,渉外担当",
        `,${"あ".repeat(TEAM_NAME_MAX + 1)},`,
      ].join("\n"),
    );
    expect(parsed.rows).toEqual([
      { line: 3, bureau: "広報局", team: "デザイン担当", order: 1, members: [], notes: [] },
      { line: 5, bureau: "総務局", team: null, members: [], notes: [] },
    ]);
    expect(parsed.errors.map((e) => e.line)).toEqual([6, 7, 8]);
    expect(parsed.errors[0]!.message).toContain("順「x」");
    expect(parsed.errors[1]!.message).toContain("局がありません");
    expect(parseTeamCsv("a,b\n1,2").errors[0]).toMatchObject({ line: 0 });
    expect(parseTeamCsv("局,担当\n").errors[0]!.message).toContain("取り込む行がありません");
  });

  it("雛形はそのまま読める", () => {
    const parsed = parseTeamCsv(teamCsvTemplate());
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(3);
  });

  it("計画: 無い局・担当だけを作る（担当の行の局が無ければ局も）。何度でも同じ", () => {
    const rows = parseTeamCsv(
      [
        "局,担当,順",
        "広報局,デザイン担当,",
        "広報局,動画担当,5",
        "財務局,会計担当,1",
        "財務局,,2",
        "企画局,",
        "財務局,会計担当,",
      ].join("\n"),
    ).rows;
    const plan = planTeamImport(rows, teams);
    expect(plan).toEqual({
      create: [
        { bureau: "広報局", team: "動画担当", order: 5 },
        { bureau: "財務局", team: null, order: 2 },
        { bureau: "財務局", team: "会計担当", order: 1 },
      ],
      existing: 2,
    });
    // 計画どおり作った後は、何も作らない
    const after: Team[] = [
      ...teams,
      t("fin", "財務局", "bureau", 2),
      t("video", "動画担当", "team", 5, "pr"),
      t("acct", "会計担当", "team", 1, "fin"),
    ];
    expect(planTeamImport(rows, after)).toEqual({ create: [], existing: rows.length });
  });
});

describe("制作物の一括登録の主管担当・制作担当", () => {
  const T0 = Date.UTC(2026, 9, 1);
  const directory = [
    { id: "u1", name: "五月 めい", email: "mei@example.invalid" },
    { id: "u2", name: "駒場 校了", email: "approver@example.invalid" },
  ];
  const header = "題名,区分,媒体,制作者,主管,校了権限者,主管担当,制作担当";

  it("局・担当を照合して ID にする。見つからない・同名が複数なら行の問題にする", () => {
    const parsed = parseWorkCsv(
      [
        header,
        "A,印刷物,PDF,五月 めい,,駒場 校了,広報局 › デザイン担当,広報局/Web担当;SNS担当",
        "B,印刷物,PDF,五月 めい,,駒場 校了,,",
        "C,印刷物,PDF,五月 めい,,駒場 校了,デザイン担当,どこか",
        "D,印刷物,PDF,五月 めい,,駒場 校了,企画局;総務局,",
      ].join("\n"),
      { defaultYear: 100, now: T0 },
    );
    expect(parsed.errors).toEqual([]);
    const preview = resolveWorkImport(parsed, directory, {}, teams);
    expect(preview.rows[0]!.input).toMatchObject({
      ownerTeamId: "design",
      productionTeamIds: ["web", "sns"],
    });
    expect(preview.rows[1]!.input).toMatchObject({ productionTeamIds: [] });
    expect(preview.rows[1]!.input).not.toHaveProperty("ownerTeamId");
    const c = preview.rows[2]!.problems.join("／");
    expect(c).toContain("担当（主管担当）「デザイン担当」に当たる担当が 2 つあります");
    expect(c).toContain("制作担当「どこか」が見つかりません");
    expect(preview.rows[3]!.problems.join()).toContain("担当（主管担当）は 1 つだけ");
    expect(preview.ready).toBe(2);
    // 組織を渡さなければ、担当を書いた行は登録できない
    expect(resolveWorkImport(parsed, directory).ready).toBe(1);
  });

  it("「主管」は人、「主管担当」は組織の列。雛形に両方の列がある", () => {
    const parsed = parseWorkCsv(workCsvTemplate(T0), { defaultYear: 100, now: T0 });
    expect(parsed.rows[0]).toMatchObject({
      managers: ["五月 主管"],
      ownerTeam: "PR › デザイン担当",
      productionTeams: ["PR › デザイン担当", "PR › SNS担当"],
      relatedTeams: ["JIM"],
    });
    const onlyOwnerTeam = parseWorkCsv(
      ["題名,区分,媒体,制作者,校了権限者,主管担当", "A,印刷物,PDF,五月 めい,駒場 校了,企画局"].join(
        "\n",
      ),
      { defaultYear: 100, now: T0 },
    );
    expect(onlyOwnerTeam.rows[0]).toMatchObject({ managers: [], ownerTeam: "企画局" });
  });
});
