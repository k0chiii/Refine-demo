import { internalMutation } from "./_generated/server";

/**
 * ローカル開発用のサンプルデータ（`npx convex run seed:demo`）。
 * NOGIKU_MOCK_ENABLED=true のデプロイメントのみで動く。本番データには触れない。
 * モックログインで `sub` を切り替えて各役割を体験できる。
 */
export const MOCK_USERS = [
  { sub: "mock-nogiku-admin", name: "五月 管理", email: "mock-admin@example.invalid", isSystemAdmin: true },
  { sub: "mock-nogiku-manager", name: "五月 主管", email: "mock-manager@example.invalid", isSystemAdmin: false },
  { sub: "mock-nogiku-creator", name: "五月 めい", email: "mock-creator@example.invalid", isSystemAdmin: false },
  { sub: "mock-nogiku-reviewer", name: "本郷 校正", email: "mock-reviewer@example.invalid", isSystemAdmin: false },
  { sub: "mock-nogiku-approver", name: "駒場 校了", email: "mock-approver@example.invalid", isSystemAdmin: false },
] as const;

export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.NOGIKU_MOCK_ENABLED !== "true") throw new Error("seed:demo is only available when NOGIKU_MOCK_ENABLED=true");
    const ids: Record<string, string> = {};
    for (const u of MOCK_USERS) {
      const existing = await ctx.db.query("users").withIndex("by_nogikuSubject", (q) => q.eq("nogikuSubject", u.sub)).unique();
      if (existing) {
        await ctx.db.patch(existing._id, { name: u.name, email: u.email, isSystemAdmin: u.isSystemAdmin, source: "nogiku_mock" });
        ids[u.sub] = existing._id;
      } else {
        ids[u.sub] = await ctx.db.insert("users", { name: u.name, email: u.email, nogikuSubject: u.sub, source: "nogiku_mock", isSystemAdmin: u.isSystemAdmin });
      }
    }
    const now = Date.now();
    const day = 86_400_000;
    const samples = [
      { title: "MF100 公式パンフレット", purpose: "来場者向け総合案内", category: "印刷物", mediaType: "pdf" as const, legacyId: "PR-001" },
      { title: "公式サイト トップページ", purpose: "Web 来場者導線", category: "Web", mediaType: "web" as const, legacyId: "WEB-003" },
      { title: "EVE 企画ポスター", purpose: "前夜祭告知", category: "グラフィック", mediaType: "image" as const, legacyId: "EVE-012" },
    ];
    const created: string[] = [];
    for (const s of samples) {
      const existing = await ctx.db.query("works").withIndex("by_year", (q) => q.eq("year", 100)).filter((q) => q.eq(q.field("legacyId"), s.legacyId)).unique();
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
      for (const [userId, role] of [[ids["mock-nogiku-manager"]!, "manager"], [ids["mock-nogiku-creator"]!, "creator"], [ids["mock-nogiku-approver"]!, "approver"]] as const) {
        await ctx.db.insert("workRoles", { workId, userId, role });
      }
      await ctx.db.insert("workPermissions", { workId, principalType: "user", principalId: ids["mock-nogiku-reviewer"]!, permission: "review", grantedBy: ids["mock-nogiku-admin"]!, grantedAt: now });
      created.push(workId);
    }
    return { users: ids, createdWorks: created };
  },
});
