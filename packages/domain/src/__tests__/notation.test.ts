import { describe, expect, it } from "vitest";
import {
  applyFindings,
  canAssignManagers,
  canEditCategory,
  compileRulePattern,
  defaultRuleCategories,
  expandCategories,
  isLikelyCatastrophic,
  notationRole,
  parseCsv,
  previewCsvImport,
  previewJsonImport,
  proofread,
  resolveRuleSet,
  snapshotOf,
  validateRuleDraft,
  type NotationRule,
  type RuleCategory,
} from "../index.ts";

const T = Date.UTC(2026, 9, 1);

function rule(over: Partial<NotationRule> & Pick<NotationRule, "ruleId">): NotationRule {
  return {
    categoryCode: "A1",
    title: over.ruleId,
    description: "",
    correct: [],
    incorrect: [],
    patterns: [],
    exceptions: [],
    language: "ja",
    scopes: [],
    years: [],
    priority: 0,
    strictness: "required",
    enabled: true,
    revision: 1,
    createdBy: "admin",
    updatedBy: "admin",
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

const cats: RuleCategory[] = defaultRuleCategories;

/** notation2 の初期データ（五月祭・昨年の五月祭・いただき） */
const seed: NotationRule[] = [
  rule({ ruleId: "A1-0001", correct: ["五月祭"], patterns: ["[5５]月祭"] }),
  rule({
    ruleId: "A1-0002",
    correct: ["昨年の五月祭"],
    patterns: ["(去年|昨年度|前回)の五月祭"],
    priority: 1,
  }),
  rule({
    ruleId: "A2-0001",
    categoryCode: "A2",
    correct: ["いただき"],
    incorrect: ["頂き"],
    description: "補助用言はひらがなで表記します。",
    exceptions: [
      { kind: "phrase", value: "頂き上げ" },
      { kind: "after", value: "物|ものです", note: "本動詞（もらう意味）は漢字" },
    ],
    strictness: "review",
  }),
];

describe("表記統一: ルールの組", () => {
  it("B を選ぶと A1〜A3 を継承し、B のルールが用途に近い（depth 0）", () => {
    const d = expandCategories(cats, ["B"]);
    expect(d.get("B")).toBe(0);
    expect(d.get("A1")).toBe(1);
    expect(d.has("E")).toBe(false);
    const rules = resolveRuleSet(
      cats,
      ["B"],
      [
        ...seed,
        rule({ ruleId: "B-0001", categoryCode: "B", correct: ["企画"], incorrect: ["きかく"] }),
      ],
      { year: 100 },
    );
    expect(rules[0]!.ruleId).toBe("B-0001");
    expect(rules.map((r) => r.ruleId)).toContain("A1-0001");
  });

  it("E（めい語）は A を継承しない。選ばないカテゴリのルールは使わない", () => {
    const rules = resolveRuleSet(cats, ["E"], seed, { year: 100 });
    expect(rules).toEqual([]);
  });

  it("年度指定のルールは他の年度に当てない（MF99 → MF100 を無条件に適用しない）", () => {
    const rules = resolveRuleSet(
      cats,
      ["A1"],
      [rule({ ruleId: "old", correct: ["x"], incorrect: ["y"], years: [99] }), ...seed],
      { year: 100 },
    );
    expect(rules.map((r) => r.ruleId)).not.toContain("old");
    expect(
      resolveRuleSet(
        cats,
        ["A1"],
        [rule({ ruleId: "old", correct: ["x"], incorrect: ["y"], years: [99] })],
        { year: 99 },
      ),
    ).toHaveLength(1);
  });

  it("無効なルール・適用範囲外・カテゴリ例外は除く", () => {
    const rules = resolveRuleSet(
      cats,
      ["C"],
      [
        rule({ ruleId: "off", correct: ["x"], incorrect: ["y"], enabled: false }),
        rule({ ruleId: "scoped", correct: ["x"], incorrect: ["y"], scopes: ["B"] }),
        rule({
          ruleId: "notInC",
          correct: ["x"],
          incorrect: ["y"],
          exceptions: [{ kind: "category", value: "C" }],
        }),
        rule({ ruleId: "ok", correct: ["x"], incorrect: ["y"] }),
      ],
      { year: 100 },
    );
    expect(rules.map((r) => r.ruleId)).toEqual(["ok"]);
  });

  it("版に記録するスナップショットはルールの版を含み、順序に依らない", () => {
    const rules = resolveRuleSet(cats, ["A1", "A2"], seed, { year: 100 });
    const a = snapshotOf(["A2", "A1"], 100, rules);
    const b = snapshotOf(["A1", "A2"], 100, [...rules].reverse());
    expect(a.rules).toContainEqual({ ruleId: "A2-0001", revision: 1 });
    expect(a.categories).toEqual(["A1", "A2"]);
    expect(b.rules).toEqual(a.rules);
    const changed = snapshotOf(
      ["A1", "A2"],
      100,
      rules.map((r) => ({ ...r, revision: r.revision + 1 })),
    );
    expect(changed.hash).not.toBe(b.hash);
  });
});

describe("表記統一: 検査エンジン", () => {
  const rules = resolveRuleSet(cats, ["A1", "A2"], seed, { year: 100 });

  it("正規表現（全角数字）と文字どおりの誤表記を見つける", () => {
    const { findings } = proofread("今年の5月祭と５月祭に来て頂き", rules);
    expect(findings.map((f) => [f.original, f.suggestion])).toEqual([
      ["5月祭", "五月祭"],
      ["５月祭", "五月祭"],
      ["頂き", "いただき"],
    ]);
    expect(findings[0]!.start).toBe(3);
    expect(findings[0]!.ruleRevision).toBe(1);
    expect(findings[0]!.detector).toBe("rule");
  });

  it("重なる一致は優先度の高いルールを残す（昨年の五月祭 > 五月祭）", () => {
    const { findings } = proofread("去年の5月祭は", [
      ...rules,
      ...resolveRuleSet(
        cats,
        ["A1"],
        [
          rule({
            ruleId: "A1-0003",
            correct: ["昨年の五月祭"],
            patterns: ["(去年|昨年度|前回)の[5５]月祭"],
            priority: 2,
          }),
        ],
        { year: 100 },
      ),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe("A1-0003");
  });

  it("用途に近いカテゴリのルールが一般ルールより優先される", () => {
    const set = resolveRuleSet(
      cats,
      ["B"],
      [
        rule({ ruleId: "A1-x", correct: ["お問い合わせ"], incorrect: ["お問合せ"], priority: 9 }),
        rule({
          ruleId: "B-x",
          categoryCode: "B",
          correct: ["お問合せ"],
          incorrect: ["お問い合わせ"],
        }),
      ],
      { year: 100 },
    );
    const { findings } = proofread("お問い合わせ", set);
    expect(findings.map((f) => f.ruleId)).toEqual(["B-x"]);
  });

  it("$1 を使った置換候補", () => {
    const set = resolveRuleSet(
      cats,
      ["A1"],
      [rule({ ruleId: "r", correct: ["第$1回"], patterns: ["第([0-9]+)次"] })],
      { year: 100 },
    );
    expect(proofread("第100次", set).findings[0]!.suggestion).toBe("第100回");
  });

  it("例外: 語句の中・直後の条件に当たるものは指摘しない", () => {
    const { findings } = proofread("頂き上げで頂き物を頂きました", rules);
    expect(findings.map((f) => f.start)).toEqual([9]);
  });

  it("要確認のルール（いただく/頂く）は断定せず needsReview にする", () => {
    const f = proofread("ご参加頂き", rules).findings[0]!;
    expect(f.needsReview).toBe(true);
    expect(f.confidence).toBe("low");
    expect(f.exceptionNote).toContain("本動詞");
  });

  it("OCR 由来は信頼度を下げ、低信頼なら要確認", () => {
    const f = proofread("5月祭", rules, { source: "ocr", ocrConfidence: 0.6 }).findings[0]!;
    expect(f.detector).toBe("ocr");
    expect(f.confidence).toBe("medium");
    expect(f.needsReview).toBe(true);
  });

  it("正しい表記に一致したものは指摘しない", () => {
    const set = resolveRuleSet(
      cats,
      ["A1"],
      [rule({ ruleId: "r", correct: ["ウェブ"], patterns: ["ウ[ェエ]ブ"] })],
      { year: 100 },
    );
    expect(proofread("ウェブとウエブ", set).findings.map((f) => f.original)).toEqual(["ウエブ"]);
  });

  it("危険・壊れた正規表現は使わず skipped に出す（他のルールは動く）", () => {
    const set = resolveRuleSet(
      cats,
      ["A1"],
      [
        rule({ ruleId: "bad", correct: ["a"], patterns: ["(a+)+$"] }),
        rule({ ruleId: "broken", correct: ["a"], patterns: ["([a"] }),
        ...seed,
      ],
      { year: 100 },
    );
    const r = proofread("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa! 5月祭", set);
    expect(r.skipped.map((s) => s.ruleId).sort()).toEqual(["bad", "broken"]);
    expect(r.findings.map((f) => f.original)).toEqual(["5月祭"]);
  });

  it("時間の上限を超えたら打ち切る", () => {
    let t = 0;
    const r = proofread("5月祭\n".repeat(50), rules, { timeBudgetMs: 10, now: () => (t += 1) });
    expect(r.truncated).toBe(true);
    expect(r.findings.length).toBeLessThan(50);
  });

  it("複数行でも位置は全文の中のオフセット", () => {
    const text = "一行目\n二行目の5月祭";
    const f = proofread(text, rules).findings[0]!;
    expect(text.slice(f.start, f.end)).toBe("5月祭");
  });

  it("ワンクリック修正は後ろから適用し、編集でずれたものは適用しない", () => {
    const text = "5月祭と５月祭";
    const { findings } = proofread(text, rules);
    expect(applyFindings(text, findings)).toBe("五月祭と五月祭");
    expect(applyFindings("X" + text, findings)).toBe("X" + text);
  });

  it("指摘の指紋は同じ入力で同じ（重複防止に使える）", () => {
    const a = proofread("5月祭", rules).findings[0]!.fingerprint;
    const b = proofread("5月祭", rules).findings[0]!.fingerprint;
    expect(a).toBe(b);
  });
});

describe("表記統一: 正規表現の安全性", () => {
  it("入れ子の量指定子・長すぎるものを拒否する", () => {
    expect(isLikelyCatastrophic("(a+)+")).toBe(true);
    expect(isLikelyCatastrophic("(\\w*)*x")).toBe(true);
    expect(isLikelyCatastrophic("(a|a)+")).toBe(true);
    expect(isLikelyCatastrophic("(去年|昨年度)の五月祭")).toBe(false);
    expect(isLikelyCatastrophic("[5５]+月祭")).toBe(false);
    expect(compileRulePattern("a".repeat(301)).ok).toBe(false);
    expect(compileRulePattern("/abc/x").ok).toBe(false);
    const ok = compileRulePattern("/ABC/i");
    expect(ok.ok && ok.regex.flags).toContain("i");
  });
});

describe("表記統一: 取り込み", () => {
  it("CSV: 見出し前の説明・カテゴリ見出し行・統一表記の無い行はルールにしない", () => {
    const csv = [
      "MF99 表記統一,,,",
      "カテゴリ,項目名,統一表記,誤表記,備考",
      "A1 固有名詞,五月祭,五月祭,5月祭、５月祭,",
      ',"説明行: 団体名は正式名称で",,,',
      "A2 日本語頻出単語,,,,",
      ",いただく,いただく,頂く,補助用言",
      ",問い合わせ,,問合せ,",
    ].join("\n");
    const p = previewCsvImport(csv, { defaultYear: 99 });
    expect(p.rules.map((r) => [r.ruleId, r.categoryCode, r.correct[0], r.incorrect])).toEqual([
      ["MF99-A1-0001", "A1", "五月祭", ["5月祭", "５月祭"]],
      ["MF99-A2-0001", "A2", "いただく", ["頂く"]],
    ]);
    expect(p.rules[0]!.years).toEqual([99]);
    expect(p.notes.map((n) => n.text)).toContain("MF99 表記統一");
    expect(p.notes.some((n) => n.text.includes("説明行"))).toBe(true);
    expect(p.warnings.some((w) => w.line === 7)).toBe(true);
  });

  it("CSV: 引用符内の改行とカンマ", () => {
    expect(parseCsv('a,"b,\nc",d\r\ne')).toEqual([["a", "b,\nc", "d"], ["e"]]);
  });

  it("CSV: 見出しが無ければ警告だけ", () => {
    const p = previewCsvImport("foo,bar\n1,2", { defaultYear: 100 });
    expect(p.rules).toEqual([]);
    expect(p.warnings).toHaveLength(1);
  });

  it("重複と矛盾を検出する（既存ルールとも比べる）", () => {
    const csv = "統一表記,誤表記\nいただく,頂く\nいただく,頂く\n頂く,いただく\n戴く,頂く";
    const p = previewCsvImport(csv, { defaultYear: 100 });
    expect(p.conflicts.find((c) => c.key === "ja:頂く")?.corrects.sort()).toEqual(
      ["いただく", "戴く"].sort(),
    );
    const existing = previewCsvImport("統一表記,誤表記\n五月祭,5月祭", {
      defaultYear: 100,
      idPrefix: "OLD",
    }).rules;
    const q = previewCsvImport("統一表記,誤表記\n五月祭,5月祭", { defaultYear: 100, existing });
    expect(q.duplicates).toHaveLength(1);
  });

  it("JSON: notation2 の wrong は正規表現として取り込み、年度は既定値", () => {
    const p = previewJsonImport(
      [
        { category: "固有名詞・文法", wrong: ["[5５]月祭"], correct: ["五月祭"] },
        {
          category: "A2",
          wrong: ["頂き"],
          correct: ["いただき"],
          exception: "本動詞として使われる場合",
        },
        { wrong: ["x"], correct: [] },
      ],
      { defaultYear: 100 },
    );
    expect(p.rules).toHaveLength(2);
    expect(p.rules[0]!.patterns).toEqual(["[5５]月祭"]);
    expect(p.rules[0]!.categoryCode).toBe("A1");
    expect(p.rules[1]!.categoryCode).toBe("A2");
    expect(p.rules[1]!.exceptions[0]!.note).toBe("本動詞として使われる場合");
    expect(p.rules[0]!.years).toEqual([100]);
    expect(p.warnings).toHaveLength(1);
  });

  it("ルールの検証", () => {
    const ok = previewJsonImport([{ ruleId: "A1-1", correct: ["a"], incorrect: ["b"] }], {
      defaultYear: 100,
    }).rules[0]!;
    expect(validateRuleDraft(ok)).toEqual([]);
    expect(validateRuleDraft({ ...ok, correct: [] })).toContain("統一表記が空です");
    expect(validateRuleDraft({ ...ok, incorrect: [], patterns: [] }).length).toBe(1);
    expect(validateRuleDraft({ ...ok, patterns: ["(a+)+"] })[0]).toMatch(/正規表現/);
  });
});

describe("表記統一: 権限", () => {
  const p = (over: Partial<{ isSystemAdmin: boolean; orgPermissions: string[] }> = {}) => ({
    userId: "u",
    isSystemAdmin: false,
    groupIds: [],
    orgPermissions: [],
    ...over,
  });
  it("システム管理者・notation:manage は全カテゴリ、担当者は担当カテゴリだけ", () => {
    expect(notationRole(p({ isSystemAdmin: true }), "A1", [])).toBe("admin");
    expect(notationRole(p({ orgPermissions: ["notation:manage"] }), "A1", [])).toBe("admin");
    expect(notationRole(p(), "B", ["B"])).toBe("manager");
    expect(notationRole(p({ orgPermissions: ["notation:category:C"] }), "C", [])).toBe("manager");
    expect(canEditCategory(p(), "A1", ["B"])).toBe(false);
  });
  it('Nogiku 未接続の "*" では管理権限を与えない', () => {
    expect(notationRole(p({ orgPermissions: ["*"] }), "A1", [])).toBe("member");
    expect(canAssignManagers(p({ orgPermissions: ["*"] }))).toBe(false);
    expect(canAssignManagers(p({ isSystemAdmin: true }))).toBe(true);
  });
});
