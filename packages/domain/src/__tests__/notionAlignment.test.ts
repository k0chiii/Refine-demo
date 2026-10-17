import { describe, expect, it } from "vite-plus/test";
import { endOfJstDate } from "../shared/deadline.ts";
import {
  findBureauByCode,
  matchTeam,
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
  normalizeSlackChannelId,
  normalizeWorkTags,
  parseWorkGenre,
  parseWorkSubGenre,
  suggestedChecksFor,
  workSubGenres,
} from "../work/metadata.ts";
import {
  parseNotionCheckbox,
  parseNotionDate,
  splitNotionList,
  stripNotionLink,
} from "../work/notionCsv.ts";
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
    expect(defaultMediaTypeFor("committee_screen")).toBe("figma");
    expect(defaultMediaTypeFor("print_booklet")).toBe("pdf");
    expect(defaultMediaTypeFor("goods")).toBe("pdf");
    // 小ジャンルが無ければ大ジャンルから。どちらも無ければ null（人が選ぶ）
    expect(defaultMediaTypeFor(null, "graphic")).toBe("image");
    expect(defaultMediaTypeFor(null, "text_foreign")).toBe("document");
    expect(defaultMediaTypeFor(null, null)).toBeNull();
  });

  it("タグは整えて重なりを除く。Slack はチャンネル ID だけ。Drive は drive.google.com の https だけ", () => {
    expect(normalizeWorkTags([" 公式パンフ ", "公式パンフ", "", "art_web"])).toEqual([
      "公式パンフ",
      "art_web",
    ]);
    expect(() => normalizeWorkTags(["あ".repeat(31)])).toThrow(invalid("tags", "too_long"));
    expect(normalizeSlackChannelId(" c0123abcdef ")).toBe("C0123ABCDEF");
    expect(normalizeSlackChannelId("")).toBeNull();
    expect(() => normalizeSlackChannelId("#general")).toThrow(invalid("slackChannelId", "format"));
    expect(
      normalizeWorkMetadata({ driveFolderUrl: "https://drive.google.com/drive/folders/x" }),
    ).toEqual({
      driveFolderUrl: "https://drive.google.com/drive/folders/x",
    });
    expect(() => normalizeWorkMetadata({ driveFolderUrl: "https://example.com/" })).toThrow(
      invalid("driveFolderUrl", "not_drive_url"),
    );
    expect(() => normalizeWorkMetadata({ printQuantity: -1 })).toThrow(
      invalid("printQuantity", "not_a_count"),
    );
    expect(() => normalizeWorkMetadata({ subGenre: "poster" as never })).toThrow(
      invalid("subGenre", "unknown"),
    );
  });

  it("変更では undefined は触らず、null で消す。関係者も名簿の確認の対象", () => {
    const work = makeWork({ tags: ["a"], slackChannelId: "C0123ABCDEF", stakeholderIds: ["s1"] });
    const next = applyWorkPatch(work, {
      genre: "graphic",
      subGenre: "print_flyer",
      tags: null,
      slackChannelId: undefined,
      publishAt: endOfJstDate("2026-05-16")!,
      stakeholderIds: ["s1", "s2", "s2"],
    });
    expect(next).toMatchObject({
      genre: "graphic",
      subGenre: "print_flyer",
      slackChannelId: "C0123ABCDEF",
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

describe("Notion の書き出しの読み方", () => {
  it("日付: 2026年5月16日・May 16, 2026・時刻付き・範囲。時刻の無い日付はその日の終わり", () => {
    const end = endOfJstDate("2026-05-16");
    expect(parseNotionDate("2026年5月16日")).toBe(end);
    expect(parseNotionDate("May 16, 2026")).toBe(end);
    expect(parseNotionDate("16 May 2026")).toBe(end);
    expect(parseNotionDate("2026/5/16")).toBe(end);
    expect(parseNotionDate("2026-05-16")).toBe(end);
    expect(parseNotionDate("2026年5月16日 18:00")).toBe(Date.UTC(2026, 4, 16, 9, 0));
    expect(parseNotionDate("May 16, 2026 6:00 PM")).toBe(Date.UTC(2026, 4, 16, 9, 0));
    expect(parseNotionDate("May 16, 2026 12:30 AM")).toBe(Date.UTC(2026, 4, 15, 15, 30));
    expect(parseNotionDate("2026年5月1日 → 2026年5月16日")).toBe(end);
    expect(parseNotionDate("")).toBeNull();
    expect(parseNotionDate("明日")).toBeUndefined();
    expect(parseNotionDate("Foo 16, 2026")).toBeUndefined();
    expect(parseNotionDate("2026-02-30")).toBeUndefined();
  });

  it("チェックボックス: Yes / No（はい・いいえ・true・false も）。リレーションのリンクは外す", () => {
    expect(parseNotionCheckbox("Yes")).toBe(true);
    expect(parseNotionCheckbox("no")).toBe(false);
    expect(parseNotionCheckbox("はい")).toBe(true);
    expect(parseNotionCheckbox("")).toBeNull();
    expect(parseNotionCheckbox("maybe")).toBeUndefined();
    expect(stripNotionLink("広報局 (https://www.notion.so/abc123def)")).toBe("広報局");
    expect(stripNotionLink("五月 めい")).toBe("五月 めい");
    expect(
      splitNotionList(
        "五月 めい (https://www.notion.so/a1), 駒場 校了 (https://www.notion.so/b2), 五月 めい",
      ),
    ).toEqual(["五月 めい", "駒場 校了"]);
    // 括弧の中の「,」では分けない
    expect(splitNotionList("印刷物（紙, ビラ）; グッズ")).toEqual(["印刷物（紙, ビラ）", "グッズ"]);
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
  team("design", "デザイン担当", "team", { parentId: "pr" }),
  team("jim", "総務局", "bureau", { code: "JIM" }),
];

describe("制作物の CSV（Notion の制作物 DB の書き出し）", () => {
  const now = Date.UTC(2026, 0, 1);
  const header =
    "制作物名,制作物 ID,大ジャンル,小ジャンル,目的・用途,担当,制作担当,関係担当,制作者,関係者,校了者,納期,入稿日・投稿日・印刷日,入稿の有無,印刷する部数/枚数/個数,サイズ・尺,制作日数,タグ,Google Drive フォルダ,Slack Channel ID,有効性,校了済み";

  it("Notion の列名で読み、区分と媒体は小ジャンルから、局はコードでも引ける。校了者が複数なら先頭を校了権限者に、残りは関係者に", () => {
    const parsed = parseWorkCsv(
      [
        header,
        [
          "公式パンフレット",
          "PR-001",
          "",
          "印刷物（冊子）",
          "来場者向け",
          "PR (https://www.notion.so/pr1)",
          "PR › デザイン担当",
          "JIM",
          "五月 めい (https://www.notion.so/u1)",
          "本郷 校正",
          '"駒場 校了 (https://www.notion.so/u2), 本郷 校正"',
          "2026年11月14日",
          '"November 20, 2026 6:00 PM"',
          "Yes",
          '"3,000"',
          "A5・48 ページ",
          "45",
          '"公式パンフ, マスター"',
          "https://drive.google.com/drive/folders/abc",
          "C0123ABCDEF",
          "Yes",
          "Yes",
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
      driveFolderUrl: "https://drive.google.com/drive/folders/abc",
      slackChannelId: "C0123ABCDEF",
      lifecycle: "active",
      problems: [],
    });
    expect(row!.notes.join()).toContain("校了者が 2 人");
    expect(row!.notes.join()).toContain("「校了済み」は取り込みません");
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
    expect(preview.rows[0]!.input).not.toHaveProperty("lifecycle");
  });

  it("有効性 No は中止として登録。読めない値は行の問題。媒体を書けばそちら", () => {
    const parsed = parseWorkCsv(
      [
        "制作物名,小ジャンル,媒体,制作者,校了者,有効性,入稿の有無,印刷する部数/枚数/個数,Slack Channel ID,Google Drive フォルダ,大ジャンル",
        "A,映像,,五月 めい,駒場 校了,No,,,,,",
        "B,webデザイン,PDF,五月 めい,駒場 校了,Yes,たぶん,たくさん,#general,https://example.com/x,漫画",
        "C,,,五月 めい,駒場 校了,,,,,,外国語文章",
      ].join("\n"),
      { defaultYear: 100, now },
    );
    const [a, b, c] = parsed.rows;
    expect(a).toMatchObject({
      lifecycle: "cancelled",
      mediaType: "video",
      genre: "video",
      category: "映像",
    });
    expect(a!.notes.join()).toContain("中止");
    expect(b!.mediaType).toBe("pdf");
    const problems = b!.problems.join("／");
    expect(problems).toContain("入稿の有無「たぶん」");
    expect(problems).toContain("印刷する部数/枚数/個数「たくさん」");
    expect(problems).toContain("Slack Channel ID「#general」");
    expect(problems).toContain("Google Drive フォルダ「https://example.com/x」");
    expect(problems).toContain("大ジャンル「漫画」");
    // 大ジャンルだけ: 区分は大ジャンルの名前、媒体は大ジャンルの既定（文章）
    expect(c).toMatchObject({
      genre: "text_foreign",
      category: "外国語文章",
      mediaType: "document",
      problems: [],
    });
    const preview = resolveWorkImport(parsed, directory, {}, teams);
    expect(preview.rows[0]!.input).toMatchObject({ lifecycle: "cancelled" });
    expect(preview.ready).toBe(2);
  });

  it("雛形は Notion の列名で、そのまま読める。以前の列名（題名・区分・媒体・校了権限者・主管担当）も読める", () => {
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
      tags: ["公式パンフ", "マスター"],
      problems: [],
    });
    expect(workCsvTemplate(now).split("\r\n")[0]).toContain(
      "制作物名,制作物 ID,大ジャンル,小ジャンル",
    );
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

describe("担当の CSV（Notion の担当 DB の書き出し）と局のコード", () => {
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
      validateTeam(
        { name: "担当", kind: "team", parentId: "pr", driveFolderUrl: "http://x" },
        teams,
      ),
    ).toThrow(expect.objectContaining({ code: "team_invalid" }));
  });

  it("Notion の列名（担当名・局・付番・絵文字・Google Drive フォルダ・ユーザ）で読む。局が複数なら先頭に入れて知らせる", () => {
    const parsed = parseTeamCsv(
      [
        "担当名,局,付番,絵文字,Google Drive フォルダ,ユーザ,メンション",
        "デザイン担当,PR,1,🎨,https://drive.google.com/drive/folders/d,五月 めい (https://www.notion.so/u1); 駒場 校了,@design",
        '横断担当,"PR, SYS",2,,,,',
        ",ZAI,,,,,",
      ].join("\n"),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      bureau: "PR",
      team: "デザイン担当",
      order: 1,
      emoji: "🎨",
      driveFolderUrl: "https://drive.google.com/drive/folders/d",
      members: ["五月 めい", "駒場 校了"],
      notes: [],
    });
    expect(parsed.rows[1]).toMatchObject({ bureau: "PR", team: "横断担当" });
    expect(parsed.rows[1]!.notes[0]).toContain("局が 2 つ");
    expect(parsed.rows[2]).toMatchObject({ bureau: "ZAI", team: null });
    // 計画: PR はコードで既存の広報局に当たる。ZAI は無いので名前もコードの局を作る。所属は照合済みの ID を入れる
    const plan = planTeamImport(parsed.rows, teams, new Map([[2, ["u1", "u2"]]]));
    expect(plan.existing).toBe(1);
    expect(plan.create).toEqual([
      { bureau: "PR", team: "横断担当", order: 2 },
      { bureau: "ZAI", team: null, code: "ZAI" },
    ]);
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
