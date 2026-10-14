import { internalMutation } from "./_generated/server";

/**
 * ローカル開発用のサンプルデータ（`npx convex run seed:demo`）。
 * NOGIKU_MOCK_ENABLED=true のデプロイメントのみで動く。本番データには触れない。
 * モックログインで `sub` を切り替えて各役割を体験できる。
 */
export const MOCK_USERS = [
  {
    sub: "mock-nogiku-admin",
    name: "五月 管理",
    email: "mock-admin@example.invalid",
    isSystemAdmin: true,
  },
  {
    sub: "mock-nogiku-manager",
    name: "五月 主管",
    email: "mock-manager@example.invalid",
    isSystemAdmin: false,
  },
  {
    sub: "mock-nogiku-creator",
    name: "五月 めい",
    email: "mock-creator@example.invalid",
    isSystemAdmin: false,
  },
  {
    sub: "mock-nogiku-reviewer",
    name: "本郷 校正",
    email: "mock-reviewer@example.invalid",
    isSystemAdmin: false,
  },
  {
    sub: "mock-nogiku-approver",
    name: "駒場 校了",
    email: "mock-approver@example.invalid",
    isSystemAdmin: false,
  },
] as const;

export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.NOGIKU_MOCK_ENABLED !== "true")
      throw new Error("seed:demo is only available when NOGIKU_MOCK_ENABLED=true");
    const ids: Record<string, string> = {};
    for (const u of MOCK_USERS) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_nogikuSubject", (q) => q.eq("nogikuSubject", u.sub))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          name: u.name,
          email: u.email,
          isSystemAdmin: u.isSystemAdmin,
          source: "nogiku_mock",
        });
        ids[u.sub] = existing._id;
      } else {
        ids[u.sub] = await ctx.db.insert("users", {
          name: u.name,
          email: u.email,
          nogikuSubject: u.sub,
          source: "nogiku_mock",
          isSystemAdmin: u.isSystemAdmin,
        });
      }
    }
    const now = Date.now();
    const day = 86_400_000;
    const samples = [
      {
        title: "MF100 公式パンフレット",
        purpose: "来場者向け総合案内",
        category: "印刷物",
        mediaType: "pdf" as const,
        legacyId: "PR-001",
        notationCategories: ["A1", "A2", "A3"],
      },
      {
        title: "公式サイト トップページ",
        purpose: "Web 来場者導線",
        category: "Web",
        mediaType: "web" as const,
        legacyId: "WEB-003",
        notationCategories: ["B"],
      },
      {
        title: "EVE 企画ポスター",
        purpose: "前夜祭告知",
        category: "グラフィック",
        mediaType: "image" as const,
        legacyId: "EVE-012",
        notationCategories: ["D"],
      },
    ];
    const created: string[] = [];
    for (const s of samples) {
      const existing = await ctx.db
        .query("works")
        .withIndex("by_year", (q) => q.eq("year", 100))
        .filter((q) => q.eq(q.field("legacyId"), s.legacyId))
        .unique();
      if (existing) continue;
      const workId = await ctx.db.insert("works", {
        ...s,
        year: 100,
        productionTeamIds: [],
        relatedTeamIds: [],
        managerIds: [ids["mock-nogiku-manager"]!],
        creatorIds: [ids["mock-nogiku-creator"]!],
        approverId: ids["mock-nogiku-approver"]!,
        deadlineAt: now + 30 * day,
        lifecycle: "active",
        confidentiality: "normal",
        version: 1,
      });
      for (const [userId, role] of [
        [ids["mock-nogiku-manager"]!, "manager"],
        [ids["mock-nogiku-creator"]!, "creator"],
        [ids["mock-nogiku-approver"]!, "approver"],
      ] as const) {
        await ctx.db.insert("workRoles", { workId, userId, role });
      }
      await ctx.db.insert("workPermissions", {
        workId,
        principalType: "user",
        principalId: ids["mock-nogiku-reviewer"]!,
        permission: "review",
        grantedBy: ids["mock-nogiku-admin"]!,
        grantedAt: now,
      });
      created.push(workId);
    }
    // 表記統一のサンプル（notation2 の初期データ＋α）。ルールが 1 件も無いときだけ入れる
    if (!(await ctx.db.query("notationRules").first())) {
      const admin = ids["mock-nogiku-admin"]!;
      for (const r of sampleRules) {
        const rule = {
          incorrect: [] as string[],
          patterns: [] as string[],
          exceptions: [] as Array<{
            kind: "phrase" | "before" | "after" | "category";
            value: string;
            note?: string;
          }>,
          language: "ja" as const,
          scopes: [] as string[],
          years: [100],
          priority: 0,
          strictness: "required" as const,
          enabled: true,
          ...r,
          revision: 1,
          createdBy: admin,
          updatedBy: admin,
          createdAt: now,
          updatedAt: now,
          publishedAt: now,
        };
        await ctx.db.insert("notationRules", rule);
        await ctx.db.insert("ruleRevisions", {
          ruleId: rule.ruleId,
          revision: 1,
          rule,
          operation: "create",
          reason: "サンプルデータ",
          actorId: admin,
          at: now,
        });
      }
      // 主管役を「企画対応（B）」のカテゴリ管理者に（カテゴリ管理者の体験用）
      await ctx.db.insert("ruleCategoryManagers", {
        userId: ids["mock-nogiku-manager"]!,
        categoryCode: "B",
        assignedBy: admin,
        assignedAt: now,
      });
    }
    return { users: ids, createdWorks: created };
  },
});

/** 表記統一のサンプルルール（MF100 の正本ではない。デモと開発用） */
const sampleRules = [
  {
    ruleId: "A1-0001",
    categoryCode: "A1",
    title: "五月祭",
    correct: ["五月祭"],
    patterns: ["[5５]月祭"],
    description: "固有名詞は漢数字で表記します。",
  },
  {
    ruleId: "A1-0002",
    categoryCode: "A1",
    title: "昨年の五月祭",
    correct: ["昨年の五月祭"],
    patterns: ["(去年|昨年度|前回)の五月祭"],
    priority: 1,
    description: "前回の開催は「昨年の五月祭」と表記します。",
  },
  {
    ruleId: "A2-0001",
    categoryCode: "A2",
    title: "いただく（補助用言）",
    correct: ["いただき"],
    incorrect: ["頂き"],
    description: "補助用言はひらがなで表記します。",
    exceptions: [
      {
        kind: "after" as const,
        value: "物|もの",
        note: "本動詞として使われる場合（例: 頂き物）は漢字",
      },
    ],
    strictness: "review" as const,
  },
  {
    ruleId: "A2-0002",
    categoryCode: "A2",
    title: "お問い合わせ",
    correct: ["お問い合わせ"],
    incorrect: ["お問合せ", "お問合わせ", "お問い合せ"],
    description: "送り仮名を省略しません。",
  },
  {
    ruleId: "A2-0003",
    categoryCode: "A2",
    title: "ください",
    correct: ["ください"],
    incorrect: ["下さい"],
    description: "補助動詞はひらがなで表記します。",
  },
  {
    ruleId: "A3-0001",
    categoryCode: "A3",
    title: "本郷キャンパス",
    correct: ["本郷キャンパス"],
    patterns: ["本郷(?!キャンパス|通り|三丁目)"],
    strictness: "recommended" as const,
    description: "会場は「本郷キャンパス」と表記します。",
  },
  {
    ruleId: "B-0001",
    categoryCode: "B",
    title: "企画",
    correct: ["企画"],
    incorrect: ["出し物"],
    strictness: "recommended" as const,
    description: "企画対応の文書では「企画」に統一します。",
  },
  {
    ruleId: "A2-9901",
    categoryCode: "A2",
    title: "（MF99）Web サイト",
    correct: ["Webサイト"],
    incorrect: ["ウェブサイト"],
    years: [99],
    description: "MF99 のルール。MF100 には適用しない例。",
  },
];
