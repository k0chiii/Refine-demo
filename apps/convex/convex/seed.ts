import { endOfJstDay } from "@mf100/domain";
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
    // SNS のアカウント（本体の設定）のサンプル。1 件も無いときだけ入れる
    let igProfile: string | undefined;
    if (!(await ctx.db.query("socialProfiles").first())) {
      const base = {
        verified: true,
        updatedAt: now,
        updatedBy: ids["mock-nogiku-admin"]!,
        avatar: SAMPLE_AVATAR,
      };
      igProfile = await ctx.db.insert("socialProfiles", {
        ...base,
        platform: "instagram",
        displayName: "第100回五月祭",
        username: "mayfes_official",
        bio: "東京大学本郷キャンパスで開催される第100回五月祭の公式アカウントです。",
        stats: { posts: 128, followers: 23400, following: 12 },
      });
      await ctx.db.insert("socialProfiles", {
        ...base,
        platform: "x",
        displayName: "第100回五月祭",
        username: "mayfes_official",
        bio: "第100回五月祭の公式アカウント。",
        stats: { posts: 2048, followers: 31200, following: 40 },
      });
    }
    // 組織（局 › 担当）のサンプル。1 件も無いときだけ入れる。企画局は担当の無い局の例
    const teamIds: Record<string, string> = {};
    const existingTeams = await ctx.db.query("teams").take(1000);
    if (existingTeams.length === 0) {
      const admin = ids["mock-nogiku-admin"]!;
      const tree: Array<[string, string[]]> = [
        ["広報局", ["デザイン担当", "SNS担当", "Web担当"]],
        ["総務局", ["渉外担当"]],
        ["企画局", []],
      ];
      for (const [bi, [bureau, children]] of tree.entries()) {
        const bureauId = await ctx.db.insert("teams", {
          name: bureau,
          kind: "bureau",
          order: bi + 1,
          updatedAt: now,
          updatedBy: admin,
        });
        teamIds[bureau] = bureauId;
        for (const [ti, name] of children.entries())
          teamIds[`${bureau}/${name}`] = await ctx.db.insert("teams", {
            name,
            kind: "team",
            parentId: bureauId,
            order: ti + 1,
            updatedAt: now,
            updatedBy: admin,
          });
      }
    } else {
      const byId = new Map(existingTeams.map((t) => [t._id as string, t]));
      for (const t of existingTeams) {
        const parent = t.parentId ? byId.get(t.parentId) : undefined;
        teamIds[parent ? `${parent.name}/${t.name}` : t.name] = t._id;
      }
    }
    /** 主管担当・制作担当（サンプルの組織が無いときは付けない） */
    const teamsOf = (owner: string | null, production: string[]) => {
      const ownerTeamId = owner ? teamIds[owner] : undefined;
      return {
        ...(ownerTeamId ? { ownerTeamId } : {}),
        productionTeamIds: production.flatMap((p) => (teamIds[p] ? [teamIds[p]] : [])),
      };
    };
    const samples = [
      {
        title: "MF100 公式パンフレット",
        purpose: "来場者向け総合案内",
        category: "印刷物",
        mediaType: "pdf" as const,
        legacyId: "PR-001",
        notationCategories: ["A1", "A2", "A3"],
        ...teamsOf("広報局/デザイン担当", ["広報局/デザイン担当"]),
      },
      {
        title: "公式サイト トップページ",
        purpose: "Web 来場者導線",
        category: "Web",
        mediaType: "web" as const,
        legacyId: "WEB-003",
        notationCategories: ["B"],
        // 制作担当が 2 つ（制作担当で並べると両方に出る）
        ...teamsOf("広報局/Web担当", ["広報局/Web担当", "広報局/デザイン担当"]),
      },
      {
        title: "EVE 企画ポスター",
        purpose: "前夜祭告知",
        category: "グラフィック",
        mediaType: "image" as const,
        legacyId: "EVE-012",
        notationCategories: ["D"],
        // 担当を決めていない例（担当別の表示で「担当未設定」に出る）
        ...teamsOf(null, []),
      },
      {
        title: "公式 Instagram 開催告知",
        purpose: "SNS での開催告知（Instagram カルーセル）",
        category: "SNS",
        mediaType: "sns" as const,
        legacyId: "SNS-021",
        notationCategories: ["A1", "A2", "A3"],
        ...(igProfile ? { socialProfileId: igProfile } : {}),
        ...teamsOf("広報局/SNS担当", ["広報局/SNS担当"]),
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
        relatedTeamIds: [],
        managerIds: [ids["mock-nogiku-manager"]!],
        creatorIds: [ids["mock-nogiku-creator"]!],
        approverId: ids["mock-nogiku-approver"]!,
        // 納期は日付だけ（その日の終わり＝翌日 0:00 JST）。30 日後の 23:59 まで
        deadlineAt: endOfJstDay(now + 30 * day),
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

/** サンプルのアカウントのアイコン（アプリのアイコン 192px の PNG） */
const SAMPLE_AVATAR =
  "data:image/png;base64,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";
