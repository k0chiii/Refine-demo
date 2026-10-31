import { describe, expect, it } from "vite-plus/test";
import {
  aiBlockReason,
  applyFindings,
  canAssignManagers,
  canEditCategory,
  compileRulePattern,
  defaultAiPolicy,
  defaultRuleCategories,
  expandCategories,
  isBotAuthor,
  isLikelyCatastrophic,
  notationRole,
  parseCsv,
  placeAiCandidates,
  planBotThreads,
  PROOFREADER_ID,
  runStatusOf,
  rulesToCsv,
  rulesToJson,
  previewCsvImport,
  previewJsonImport,
  proofread,
  publicProposalTitle,
  remainingBotThreadQuota,
  BOT_THREADS_PER_ARTIFACT,
  resolveRuleSet,
  restoreRuleSet,
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
    expect(a.rules).toContainEqual({ ruleId: "A2-0001", revision: 1, depth: 0 });
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

describe("表記統一: 空一致する正規表現", () => {
  it("空の文字列に一致できる正規表現は登録の時点で拒否する", () => {
    expect(compileRulePattern("(?:)").ok).toBe(false);
    expect(compileRulePattern("a*").ok).toBe(false);
    expect(compileRulePattern("/x?/i").ok).toBe(false);
    expect(compileRulePattern("^").ok).toBe(false);
    expect(compileRulePattern("[5５]月祭").ok).toBe(true);
    expect(validateRuleDraft({ ...seed[0]!, patterns: ["(?:)"] })).toEqual([
      expect.stringContaining("空の文字列"),
    ]);
    // 例外条件（直前・直後の文脈）は従来どおり受け入れる
    expect(compileRulePattern("\\s*", { allowEmptyMatch: true }).ok).toBe(true);
  });

  it("文中で空一致するもの（先読みなど）は絵文字の本文でも止まり、指摘にしない", () => {
    const r = rule({ ruleId: "look", correct: ["x"], patterns: ["(?=😀)", "(?=五)"] });
    const res = proofread("😀五月祭😀\n😀😀", [{ ...r, depth: 0 }]);
    expect(res.findings).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  it("時間の上限は一致のたびに確かめる（1 行の中でも打ち切れる）", () => {
    let t = 0;
    const r = rule({ ruleId: "a", correct: ["い"], incorrect: ["あ"] });
    const res = proofread("あ".repeat(100), [{ ...r, depth: 0 }], {
      now: () => t++,
      timeBudgetMs: 10,
    });
    expect(res.truncated).toBe(true);
    expect(res.findings.length).toBeLessThan(100);
  });
});

describe("表記統一: 版のルールの組の復元", () => {
  it("記録した深さで復元し、今のカテゴリの継承では選び直さない", () => {
    const rules = resolveRuleSet(cats, ["B"], seed, { year: 100 });
    const snap = snapshotOf(["B"], 100, rules);
    expect(snap.rules.every((r) => r.depth === 1)).toBe(true);
    const noInherit = cats.map((c) => (c.code === "B" ? { ...c, parents: [] } : c));
    const restored = restoreRuleSet(snap, seed, noInherit);
    expect(restored.map((r) => [r.ruleId, r.depth])).toEqual(rules.map((r) => [r.ruleId, r.depth]));
    // 版の一致しないルールは使わない
    expect(
      restoreRuleSet(
        snap,
        seed.map((r) => ({ ...r, revision: 2 })),
      ),
    ).toEqual([]);
  });
});

describe("表記統一: 提案の公開題名", () => {
  const base = {
    kind: "report" as const,
    correct: [] as string[],
    incorrect: [] as string[],
    context: { quote: "機密の文", surrounding: "前後の機密の文です" },
  };
  it("文脈と重なる題名は中立的な題名にし、表記そのものの題名は残す", () => {
    expect(publicProposalTitle({ ...base, title: "機密の文" })).toBe("誤表記の報告");
    expect(publicProposalTitle({ ...base, title: "機密" })).toBe("誤表記の報告");
    expect(publicProposalTitle({ ...base, title: "" })).toBe("誤表記の報告");
    expect(publicProposalTitle({ ...base, title: "機密", incorrect: ["機密"] })).toBe("機密");
    expect(publicProposalTitle({ ...base, title: "送り仮名の揺れ" })).toBe("送り仮名の揺れ");
    expect(publicProposalTitle({ ...base, context: {}, title: "機密の文" })).toBe("機密の文");
  });
});

describe("自動校正: 添付ごとの上限", () => {
  it("保存済みの数を差し引いた残りだけ計画する", () => {
    expect(remainingBotThreadQuota(0)).toBe(BOT_THREADS_PER_ARTIFACT);
    expect(remainingBotThreadQuota(BOT_THREADS_PER_ARTIFACT + 5)).toBe(0);
    const rules = resolveRuleSet(cats, ["A1"], seed, { year: 100 });
    const seg = { kind: "text" as const, text: "5月祭と5月祭と5月祭" };
    expect(planBotThreads("a", [seg], rules, 2)).toMatchObject({ truncated: true });
    expect(planBotThreads("a", [seg], rules, 2).planned).toHaveLength(2);
    expect(planBotThreads("a", [seg], rules, 0)).toEqual({ planned: [], truncated: true });
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

  it("書き出し → 取り込みで内容が戻る（CSV は ID・複数表記・正規表現の | を保つ）", () => {
    const src = previewJsonImport(
      [
        {
          ruleId: "A1-0002",
          categoryCode: "A1",
          title: "昨年",
          correct: ["昨年の五月祭"],
          patterns: ["(去年|前回)の五月祭", "昨年度の五月祭"],
          years: [100, 101],
          strictness: "recommended",
          enabled: false,
        },
        {
          ruleId: "A2-0001",
          categoryCode: "A2",
          title: "ください",
          correct: ["ください"],
          incorrect: ["下さい", "下さ い"],
          description: "補助動詞, ひらがな",
        },
      ],
      { defaultYear: 100 },
    ).rules;
    const back = previewCsvImport(rulesToCsv(src), { defaultYear: 100 }).rules;
    expect(
      back.map((r) => [
        r.ruleId,
        r.categoryCode,
        r.correct,
        r.incorrect,
        r.patterns,
        r.years,
        r.strictness,
        r.enabled,
        r.description,
      ]),
    ).toEqual(
      src.map((r) => [
        r.ruleId,
        r.categoryCode,
        r.correct,
        r.incorrect,
        r.patterns,
        r.years,
        r.strictness,
        r.enabled,
        r.description,
      ]),
    );
    const json = previewJsonImport(JSON.parse(rulesToJson(src, [])), { defaultYear: 99 }).rules;
    expect(json).toEqual(src);
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

describe("自動校正: スレッドの計画", () => {
  const rules = resolveRuleSet(cats, ["A1", "A2"], seed, { year: 100 });
  it("文章は text_range、PDF はページ上の矩形、OCR は画像の矩形で、指紋は同じ入力で同じ", () => {
    const text = planBotThreads("art1", [{ kind: "text", text: "5月祭に来て頂き" }], rules);
    expect(text.planned.map((p) => p.anchor.type)).toEqual(["text_range", "text_range"]);
    expect(text.planned[0]!.body).toContain("「5月祭」→「五月祭」");
    expect(text.planned[0]!.body).toContain("A1-0001 改訂 1");
    expect(text.planned[0]!.severity).toBe("minor");
    expect(text.planned[1]!.body.startsWith("【要確認】")).toBe(true);
    expect(text.planned[1]!.severity).toBe("info");
    const again = planBotThreads("art1", [{ kind: "text", text: "5月祭に来て頂き" }], rules);
    expect(again.planned.map((p) => p.fingerprint)).toEqual(text.planned.map((p) => p.fingerprint));

    const page = planBotThreads(
      "art2",
      [
        {
          kind: "page",
          page: 3,
          text: "今年の5月祭",
          boxes: [{ start: 0, end: 6, rect: { x: 0.1, y: 0.2, w: 0.6, h: 0.05 } }],
        },
      ],
      rules,
    );
    const a = page.planned[0]!.anchor;
    expect(a.type).toBe("pdf_rect");
    if (a.type === "pdf_rect") {
      expect(a.page).toBe(3);
      expect(a.rect.x).toBeCloseTo(0.1 + 0.6 * (3 / 6));
      expect(a.rect.w).toBeCloseTo(0.6 * (3 / 6));
    }
    expect(page.planned[0]!.origin.textSource).toBe("pdf_text");

    const ocr = planBotThreads(
      "art3",
      [
        {
          kind: "image",
          text: "5月祭",
          confidence: 0.5,
          boxes: [{ start: 0, end: 3, rect: { x: 0, y: 0, w: 0.5, h: 0.1 } }],
        },
      ],
      rules,
    );
    expect(ocr.planned[0]!.anchor.type).toBe("image_rect");
    expect(ocr.planned[0]!.origin.detector).toBe("ocr");
    expect(ocr.planned[0]!.origin.needsReview).toBe(true);
    // 文字の無い PDF ページを OCR したものは OCR 由来（低信頼なら要確認）
    const scanned = planBotThreads(
      "art5",
      [
        {
          kind: "page",
          page: 2,
          text: "5月祭",
          ocrConfidence: 0.5,
          boxes: [{ start: 0, end: 3, rect: { x: 0, y: 0, w: 0.5, h: 0.1 } }],
        },
      ],
      rules,
    );
    expect(scanned.planned[0]!.anchor.type).toBe("pdf_rect");
    expect(scanned.planned[0]!.origin.textSource).toBe("ocr");
    expect(scanned.planned[0]!.origin.needsReview).toBe(true);
    // 矩形の無い文字は作らない
    expect(
      planBotThreads("art4", [{ kind: "page", page: 1, text: "5月祭", boxes: [] }], rules).planned,
    ).toEqual([]);
  });

  it("実行の状態", () => {
    expect(runStatusOf([])).toBe("skipped");
    expect(runStatusOf([{ artifactId: "a", status: "pending", findings: 0 }])).toBe("pending");
    expect(
      runStatusOf([
        { artifactId: "a", status: "done", findings: 1 },
        { artifactId: "b", status: "pending", findings: 0 },
      ]),
    ).toBe("running");
    expect(
      runStatusOf([
        { artifactId: "a", status: "done", findings: 1 },
        { artifactId: "b", status: "failed", findings: 0 },
      ]),
    ).toBe("failed");
    expect(isBotAuthor(PROOFREADER_ID)).toBe(true);
  });
});

describe("AI 校正の候補（サーバーでの確認）", () => {
  it("本文に無い候補・同じ文字は捨て、要確認の候補として位置を付ける", () => {
    const text = "五月祭は5月に開催。5月に来てね";
    const f = placeAiCandidates(
      text,
      [
        { original: "5月", suggestion: "五月", reason: "漢数字", ruleId: "A1-0001" },
        { original: "5月", suggestion: "五月", reason: "漢数字" },
        { original: "存在しない", suggestion: "x", reason: "" },
        { original: "開催", suggestion: "開催", reason: "" },
      ],
      new Map([["A1-0001", 3]]),
    );
    expect(f.map((x) => [x.start, x.ruleId, x.ruleRevision])).toEqual([
      [4, "A1-0001", 3],
      [10, "AI", 0],
    ]);
    expect(f.every((x) => x.detector === "ai" && x.needsReview)).toBe(true);
  });
  it("有効なときだけ使える（API キー・enabled）", () => {
    expect(aiBlockReason(defaultAiPolicy)).toMatch(/設定されていません/);
    expect(aiBlockReason({ ...defaultAiPolicy, enabled: true })).toBeNull();
  });
});
