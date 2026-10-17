import { describe, expect, it } from "vite-plus/test";
import { parseCsvBoolean, parseCsvDateTime, splitCsvList } from "../shared/csvValues.ts";
import { endOfJstDate } from "../shared/deadline.ts";
import {
  findBureauByCode,
  matchTeam,
  memberTeamIds,
  parseTeamCsv,
  planTeamImport,
  teamCsvTemplate,
  validateTeam,
  type Team,
} from "../org/team.ts";
import { parseWorkCsv, resolveWorkImport, workCsvTemplate } from "../work/bulkImport.ts";
import {
  checklistFor,
  currentDeclarations,
  defaultMediaTypeFor,
  genreOfSubGenre,
  normalizeWorkTags,
  parseWorkGenre,
  parseWorkSubGenre,
  suggestedChecksFor,
  workSubGenres,
} from "../work/metadata.ts";
import { applyWorkPatch, newlyReferencedPeople, normalizeWorkMetadata } from "../work/workInput.ts";
import { makeRevision, makeWork, T0 } from "./fixtures.ts";

const invalid = (field: string, reason: string) =>
  expect.objectContaining({
    code: "work_invalid",
    details: expect.objectContaining({ field, reason }),
  });

describe("Notion の制作物 DB に揃えた項目（docs/NOTION_ALIGNMENT.md）", () => {
  it("小ジャンルは Notion の 22 の選択肢。色の組が大ジャンル、媒体の既定が決まる", () => {
    expect(workSubGenres).toHaveLength(22);
    expect(parseWorkSubGenre("デジタル画像（SNS投稿用画像）")).toBe("digital_sns");
    expect(parseWorkSubGenre("デジタル画像(SNS投稿用画像)")).toBe("digital_sns"); // 括弧のゆれ
    expect(parseWorkSubGenre("web原稿")).toBe("web_copy");
    expect(parseWorkSubGenre("print_booklet")).toBe("print_booklet"); // 内部のコードも
    expect(parseWorkSubGenre("ポスター")).toBeNull();
    expect(genreOfSubGenre("print_flyer")).toBe("graphic");
    expect(genreOfSubGenre("web_design")).toBe("ui");
    expect(genreOfSubGenre("pr_text")).toBe("text_ja");
    expect(genreOfSubGenre("video")).toBe("video");
    expect(parseWorkGenre("日本語文章")).toBe("text_ja");
    expect(parseWorkGenre("UI")).toBe("ui");
    expect(parseWorkGenre("漫画")).toBeNull();
  });

  it("媒体の既定: 映像 → 動画、SNS 投稿用画像 → SNS 投稿、文章 → 文章、webデザイン → Web、委員会システム画面 → Figma、印刷物 → PDF、画像 → 画像", () => {
    expect(defaultMediaTypeFor("video")).toBe("video");
    expect(defaultMediaTypeFor("digital_sns")).toBe("sns");
    expect(defaultMediaTypeFor("digital_web")).toBe("image");
    expect(defaultMediaTypeFor("web_copy")).toBe("document");
    expect(defaultMediaTypeFor("pr_text")).toBe("document");
    expect(defaultMediaTypeFor("web_design")).toBe("web");
    // 利用者決定 2026-10-17（5）: 委員会システム画面の媒体の既定は Figma のまま
    expect(defaultMediaTypeFor("committee_screen")).toBe("figma");
    expect(defaultMediaTypeFor("print_booklet")).toBe("pdf");
    expect(defaultMediaTypeFor("goods")).toBe("pdf");
    // 小ジャンルが無ければ大ジャンルから。どちらも無ければ null（人が選ぶ）
    expect(defaultMediaTypeFor(null, "graphic")).toBe("image");
    expect(defaultMediaTypeFor(null, "text_foreign")).toBe("document");
    expect(defaultMediaTypeFor(null, null)).toBeNull();
  });

  it("タグは整えて重なりを除く。部数・小ジャンルは決まった形だけ", () => {
    expect(normalizeWorkTags([" 公式パンフ ", "公式パンフ", "", "art_web"])).toEqual([
      "公式パンフ",
      "art_web",
    ]);
    expect(() => normalizeWorkTags(["あ".repeat(31)])).toThrow(invalid("tags", "too_long"));
    expect(() => normalizeWorkMetadata({ printQuantity: -1 })).toThrow(
      invalid("printQuantity", "not_a_count"),
    );
    expect(() => normalizeWorkMetadata({ subGenre: "poster" as never })).toThrow(
      invalid("subGenre", "unknown"),
    );
  });

  it("変更では undefined は触らず、null で消す。関係者も名簿の確認の対象", () => {
    const work = makeWork({ tags: ["a"], sizeOrLength: "A4", stakeholderIds: ["s1"] });
    const next = applyWorkPatch(work, {
      genre: "graphic",
      subGenre: "print_flyer",
      tags: null,
      sizeOrLength: undefined,
      publishAt: endOfJstDate("2026-05-16")!,
      stakeholderIds: ["s1", "s2", "s2"],
    });
    expect(next).toMatchObject({
      genre: "graphic",
      subGenre: "print_flyer",
      sizeOrLength: "A4",
      publishAt: endOfJstDate("2026-05-16"),
      stakeholderIds: ["s1", "s2"],
      version: work.version + 1,
    });
    expect(next).not.toHaveProperty("tags");
    expect(newlyReferencedPeople(work, next)).toEqual(["s2"]);
  });

  it("「現在の版」の申告は void でない最新の版のもの。申告から勧める専門確認は 写真 → 写真、指針外の色 → デザイン", () => {
    const d1 = { usesPhotos: true, usesMascot: false, usesOffPaletteColors: false };
    const d2 = { usesPhotos: false, usesMascot: true, usesOffPaletteColors: true };
    const r1 = makeRevision({ id: "r1", sequence: 1, submittedAt: T0, declarations: d1 });
    const r2 = makeRevision({ id: "r2", sequence: 2, submittedAt: T0 + 1, declarations: d2 });
    const r3 = makeRevision({ id: "r3", sequence: 3, submittedAt: T0 + 2, reviewState: "void" });
    expect(currentDeclarations([r1, r2, r3])).toEqual(d2);
    expect(currentDeclarations([r1])).toEqual(d1);
    expect(currentDeclarations([makeRevision()])).toBeNull();
    expect(currentDeclarations([])).toBeNull();
    expect(suggestedChecksFor(d1)).toEqual(["photo"]);
    expect(suggestedChecksFor(d2)).toEqual(["design"]);
    // 文章の制作物だけに「表記統一システムを通したか」が出る
    expect(checklistFor("graphic").map((c) => c.id)).not.toContain("notation_checked");
    expect(checklistFor("text_ja").map((c) => c.id)).toContain("notation_checked");
    expect(checklistFor("text_foreign")).toHaveLength(5);
  });
});

describe("CSV のセルの読み方（アプリの雛形。外部ツールの書き出しは特別扱いしない）", () => {
  it("日付: 2026-11-14・2026/11/14・時刻付き。時刻の無い日付はその日の終わり", () => {
    const end = endOfJstDate("2026-05-16");
    expect(parseCsvDateTime("2026/5/16")).toBe(end);
    expect(parseCsvDateTime("2026-05-16")).toBe(end);
    expect(parseCsvDateTime("2026-05-16 18:00")).toBe(Date.UTC(2026, 4, 16, 9, 0));
    expect(parseCsvDateTime("")).toBeNull();
    expect(parseCsvDateTime("明日")).toBeUndefined();
    expect(parseCsvDateTime("2026年5月16日")).toBeUndefined();
    expect(parseCsvDateTime("May 16, 2026")).toBeUndefined();
    expect(parseCsvDateTime("2026-02-30")).toBeUndefined();
  });

  it("チェックボックス: Yes / No（はい・いいえ・true・false も）。複数の値は区切りで分け、括弧の中では分けない", () => {
    expect(parseCsvBoolean("Yes")).toBe(true);
    expect(parseCsvBoolean("no")).toBe(false);
    expect(parseCsvBoolean("はい")).toBe(true);
    expect(parseCsvBoolean("")).toBeNull();
    expect(parseCsvBoolean("maybe")).toBeUndefined();
    expect(splitCsvList("五月 めい, 駒場 校了; 五月 めい")).toEqual(["五月 めい", "駒場 校了"]);
    expect(splitCsvList("印刷物（紙, ビラ）; グッズ")).toEqual(["印刷物（紙, ビラ）", "グッズ"]);
  });
});

const directory = [
  { id: "u1", name: "五月 めい", email: "mei@example.invalid" },
  { id: "u2", name: "駒場 校了", email: "approver@example.invalid" },
  { id: "u3", name: "本郷 校正", email: "reviewer@example.invalid" },
];
const team = (id: string, name: string, kind: Team["kind"], extra: Partial<Team> = {}): Team => ({
  id,
  name,
  kind,
  order: 1,
  updatedAt: 0,
  updatedBy: "admin",
  ...extra,
});
const teams = [
  team("pr", "広報局", "bureau", { code: "PR" }),
  team("design", "デザイン担当", "team", { parentId: "pr", memberIds: ["u3"] }),
  team("jim", "総務局", "bureau", { code: "JIM" }),
];

describe("制作物の CSV（委員会の制作物 DB の項目名）", () => {
  const now = Date.UTC(2026, 0, 1);
  const header =
    "制作物名,制作物 ID,大ジャンル,小ジャンル,目的・用途,担当,制作担当,関係担当,制作者,関係者,校了者,納期,入稿日・投稿日・印刷日,入稿の有無,印刷する部数/枚数/個数,サイズ・尺,制作日数,タグ";

  it("項目名で読み、区分と媒体は小ジャンルから、局はコードでも引ける", () => {
    const parsed = parseWorkCsv(
      [
        header,
        [
          "公式パンフレット",
          "PR-001",
          "",
          "印刷物（冊子）",
          "来場者向け",
          "PR",
          "PR › デザイン担当",
          "JIM",
          "五月 めい",
          "本郷 校正",
          "駒場 校了",
          "2026-11-14",
          "2026-11-20 18:00",
          "Yes",
          '"3,000"',
          "A5・48 ページ",
          "45",
          '"公式パンフ, マスター"',
        ].join(","),
      ].join("\n"),
      { defaultYear: 100, now },
    );
    expect(parsed.errors).toEqual([]);
    const [row] = parsed.rows;
    expect(row).toMatchObject({
      title: "公式パンフレット",
      legacyId: "PR-001",
      genre: "graphic",
      subGenre: "print_booklet",
      category: "印刷物（冊子）",
      mediaType: "pdf",
      ownerTeam: "PR",
      productionTeams: ["PR › デザイン担当"],
      relatedTeams: ["JIM"],
      creators: ["五月 めい"],
      stakeholders: ["本郷 校正"],
      approver: "駒場 校了",
      deadlineAt: endOfJstDate("2026-11-14"),
      publishAt: Date.UTC(2026, 10, 20, 9, 0),
      requiresPrinterSubmission: true,
      printQuantity: 3000,
      sizeOrLength: "A5・48 ページ",
      productionDays: 45,
      tags: ["公式パンフ", "マスター"],
      problems: [],
    });
    const preview = resolveWorkImport(parsed, directory, {}, teams);
    expect(preview.ready).toBe(1);
    expect(preview.rows[0]!.input).toMatchObject({
      ownerTeamId: "pr",
      productionTeamIds: ["design"],
      relatedTeamIds: ["jim"],
      creatorIds: ["u1"],
      approverId: "u2",
      stakeholderIds: ["u3"],
      genre: "graphic",
      subGenre: "print_booklet",
      tags: ["公式パンフ", "マスター"],
    });
  });

  it("校了者が複数・制作担当が複数の行は取り込まない（1 人・1 つ）。有効性・校了済みの列は無い", () => {
    const parsed = parseWorkCsv(
      [
        "制作物名,小ジャンル,媒体,制作者,校了者,制作担当,入稿の有無,印刷する部数/枚数/個数,大ジャンル,有効性",
        "A,映像,,五月 めい,駒場 校了; 本郷 校正,,,,,No",
        "B,webデザイン,PDF,五月 めい,駒場 校了,PR › デザイン担当; JIM,たぶん,たくさん,漫画,",
        "C,,,五月 めい,駒場 校了,JIM,,,外国語文章,",
      ].join("\n"),
      { defaultYear: 100, now },
    );
    const [a, b, c] = parsed.rows;
    expect(a).toMatchObject({ mediaType: "video", genre: "video", category: "映像" });
    expect(a!.problems.join("／")).toContain("校了者が 2 人");
    expect(a).not.toHaveProperty("lifecycle");
    expect(b!.mediaType).toBe("pdf");
    const problems = b!.problems.join("／");
    expect(problems).toContain("制作担当は 1 つだけ");
    expect(problems).toContain("入稿の有無「たぶん」");
    expect(problems).toContain("印刷する部数/枚数/個数「たくさん」");
    expect(problems).toContain("大ジャンル「漫画」");
    // 大ジャンルだけ: 区分は大ジャンルの名前、媒体は大ジャンルの既定（文章）
    expect(c).toMatchObject({
      genre: "text_foreign",
      category: "外国語文章",
      mediaType: "document",
      productionTeams: ["JIM"],
      problems: [],
    });
    const preview = resolveWorkImport(parsed, directory, {}, teams);
    expect(preview.ready).toBe(1);
    expect(preview.rows[2]!.input).toMatchObject({ productionTeamIds: ["jim"] });
    // ポリシー値を上げれば複数の制作担当も読める
    const relaxed = parseWorkCsv(
      [
        "制作物名,小ジャンル,制作者,校了者,制作担当",
        "B,webデザイン,五月 めい,駒場 校了,PR;JIM",
      ].join("\n"),
      { defaultYear: 100, now, teamPolicy: { maxProductionTeams: 2 } },
    );
    expect(relaxed.rows[0]!.problems).toEqual([]);
  });

  it("雛形はそのまま読める。以前の列名（題名・区分・媒体・校了権限者・主管担当）も読める", () => {
    const parsed = parseWorkCsv(workCsvTemplate(now), { defaultYear: 100, now });
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      title: "MF100 公式パンフレット",
      legacyId: "PR-001",
      genre: "graphic",
      subGenre: "print_booklet",
      mediaType: "pdf",
      requiresPrinterSubmission: true,
      printQuantity: 3000,
      productionTeams: ["PR › デザイン担当"],
      tags: ["公式パンフ", "マスター"],
      problems: [],
    });
    const head = workCsvTemplate(now).split("\r\n")[0]!;
    expect(head).toContain("制作物名,制作物 ID,大ジャンル,小ジャンル");
    expect(head).not.toContain("有効性");
    const old = parseWorkCsv(
      [
        "題名,区分,媒体,制作者,校了権限者,主管担当,旧ID",
        "A,印刷物,PDF,五月 めい,駒場 校了,広報局,PR-9",
      ].join("\n"),
      { defaultYear: 100, now },
    );
    expect(old.errors).toEqual([]);
    expect(old.rows[0]).toMatchObject({
      category: "印刷物",
      mediaType: "pdf",
      ownerTeam: "広報局",
      legacyId: "PR-9",
    });
  });
});

describe("担当の CSV（委員会の担当 DB の項目名）と局のコード・所属", () => {
  it("局はコードで引ける。コードは選択肢の中、局だけ、重ならない", () => {
    expect(findBureauByCode("pr", teams)?.id).toBe("pr");
    expect(findBureauByCode("ZAI", teams)).toBeNull();
    expect(matchTeam("JIM", teams)).toMatchObject({ kind: "ok", team: { id: "jim" } });
    expect(matchTeam("PR › デザイン担当", teams)).toMatchObject({
      kind: "ok",
      team: { id: "design" },
    });
    expect(
      validateTeam({ name: "財務局", kind: "bureau", code: "zai", emoji: "💰" }, teams),
    ).toMatchObject({
      code: "ZAI",
      emoji: "💰",
    });
    expect(() => validateTeam({ name: "財務局", kind: "bureau", code: "XYZ" }, teams)).toThrow(
      expect.objectContaining({ code: "team_invalid" }),
    );
    expect(() => validateTeam({ name: "別の広報局", kind: "bureau", code: "PR" }, teams)).toThrow(
      expect.objectContaining({ code: "team_duplicate" }),
    );
    expect(() =>
      validateTeam({ name: "担当", kind: "team", parentId: "pr", code: "PR" }, teams),
    ).toThrow(expect.objectContaining({ code: "team_invalid" }));
    expect(() =>
      validateTeam({ name: "担当", kind: "team", parentId: "pr", emoji: "あ い" }, teams),
    ).toThrow(expect.objectContaining({ code: "team_invalid" }));
  });

  it("所属する担当の ID（Principal.teamIds に入れる）", () => {
    expect(memberTeamIds(teams, "u3")).toEqual(["design"]);
    expect(memberTeamIds(teams, "u1")).toEqual([]);
  });

  it("項目名（担当名・局・付番・絵文字・ユーザ）で読む。局が複数の行は取り込まない", () => {
    const parsed = parseTeamCsv(
      [
        "担当名,局,付番,絵文字,ユーザ,メンション",
        "デザイン担当,PR,1,🎨,五月 めい; 駒場 校了,@design",
        '横断担当,"PR, SYS",2,,,',
        ",ZAI,,,,",
      ].join("\n"),
    );
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatchObject({ line: 3 });
    expect(parsed.errors[0]!.message).toContain("局が 2 つ");
    expect(parsed.rows[0]).toMatchObject({
      bureau: "PR",
      team: "デザイン担当",
      order: 1,
      emoji: "🎨",
      members: ["五月 めい", "駒場 校了"],
    });
    expect(parsed.rows[1]).toMatchObject({ bureau: "ZAI", team: null });
    // 計画: PR はコードで既存の広報局に当たる（担当も既存）。ZAI は無いので名前もコードの局を作る。所属は照合済みの ID
    const plan = planTeamImport(parsed.rows, teams, new Map([[2, ["u1", "u2"]]]));
    expect(plan.existing).toBe(1);
    expect(plan.create).toEqual([{ bureau: "ZAI", team: null, code: "ZAI" }]);
    const fresh = planTeamImport(parsed.rows, [], new Map([[2, ["u1", "u2"]]]));
    expect(fresh.create[0]).toEqual({ bureau: "PR", team: null, code: "PR" });
    expect(fresh.create[1]).toMatchObject({
      team: "デザイン担当",
      emoji: "🎨",
      memberIds: ["u1", "u2"],
    });
    expect(parseTeamCsv(teamCsvTemplate()).rows.map((r) => r.bureau)).toEqual(["PR", "PR", "JIM"]);
  });
});
