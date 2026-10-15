import { groupWorksByTeam, parseTeamCsv, teamCsvTemplate } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";

const byText = (a: string, b: string) => a.localeCompare(b);
const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

describe("Convex 統合: 組織（局 › 担当）", () => {
  it("システム管理者だけが登録・変更・削除でき、誰でも並んだ一覧を見られる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await expect(
      cast.manager.as.mutation(api.teams.save, { name: "広報局", kind: "bureau" }),
    ).rejects.toThrow(code("forbidden"));
    const pr = await cast.admin.as.mutation(api.teams.save, { name: "広報局", kind: "bureau" });
    const design = await cast.admin.as.mutation(api.teams.save, {
      name: "デザイン担当",
      kind: "team",
      parentId: pr,
    });
    await cast.admin.as.mutation(api.teams.save, { name: "総務局", kind: "bureau", order: 0 });
    expect((await cast.creator.as.query(api.teams.list, {})).map((x) => x.name)).toEqual([
      "総務局",
      "広報局",
      "デザイン担当",
    ]);
    await expect(
      cast.admin.as.mutation(api.teams.save, { name: "広報局", kind: "bureau" }),
    ).rejects.toThrow(code("team_duplicate"));
    await cast.admin.as.mutation(api.teams.save, {
      id: design,
      name: "デザイン・印刷担当",
      kind: "team",
      parentId: pr,
    });
    // 担当がある局は消せない。担当を消せば消せる
    await expect(cast.admin.as.mutation(api.teams.remove, { id: pr })).rejects.toThrow(
      code("team_in_use"),
    );
    await expect(cast.manager.as.mutation(api.teams.remove, { id: design })).rejects.toThrow(
      code("forbidden"),
    );
    await cast.admin.as.mutation(api.teams.remove, { id: design });
    await cast.admin.as.mutation(api.teams.remove, { id: pr });
    expect((await cast.creator.as.query(api.teams.list, {})).map((x) => x.name)).toEqual([
      "総務局",
    ]);
  });

  it("CSV の取り込みは無いものだけを作り、2 回目は何も作らない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const { rows } = parseTeamCsv(teamCsvTemplate());
    await expect(cast.manager.as.mutation(api.teams.importBatch, { rows })).rejects.toThrow(
      code("forbidden"),
    );
    expect(await cast.admin.as.mutation(api.teams.importBatch, { rows })).toEqual({
      created: 5,
      existing: 0,
    });
    expect(await cast.admin.as.mutation(api.teams.importBatch, { rows })).toEqual({
      created: 0,
      existing: 3,
    });
    expect((await cast.admin.as.query(api.teams.list, {})).map((x) => x.name)).toEqual([
      "広報局",
      "デザイン担当",
      "SNS担当",
      "総務局",
      "渉外担当",
    ]);
  });

  it("制作物の担当: 無い ID は拒否、使っている担当は消せない。一覧に担当と制作者の名前が出る", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await cast.admin.as.mutation(api.teams.importBatch, {
      rows: parseTeamCsv(teamCsvTemplate()).rows,
    });
    const list = await cast.admin.as.query(api.teams.list, {});
    const id = (name: string) => list.find((x) => x.name === name)!.id;
    const base = {
      title: "パンフレット",
      purpose: "",
      category: "印刷物",
      mediaType: "pdf" as const,
      year: 100,
      creatorIds: [cast.creator.id],
      approverId: cast.approver.id,
    };
    await expect(
      cast.manager.as.mutation(api.works.create, { ...base, ownerTeamId: "nope" }),
    ).rejects.toThrow(code("team_not_found"));
    const workId = (await cast.manager.as.mutation(api.works.create, {
      ...base,
      ownerTeamId: id("デザイン担当"),
      productionTeamIds: [id("デザイン担当"), id("SNS担当")],
    })) as Id<"works">;
    await expect(cast.admin.as.mutation(api.teams.remove, { id: id("SNS担当") })).rejects.toThrow(
      code("team_in_use"),
    );
    const [row] = await cast.creator.as.query(api.works.listMine, {});
    expect(row).toMatchObject({
      id: workId,
      ownerTeamId: id("デザイン担当"),
      productionTeamIds: [id("デザイン担当"), id("SNS担当")],
      creators: ["creator"],
    });
    const groups = groupWorksByTeam([row!], list, "production");
    expect(groups[0]!.teams.map((g) => g.team?.name)).toEqual(["デザイン担当", "SNS担当"]);
    // 主管担当を外す（空文字）
    await cast.manager.as.mutation(api.works.update, {
      workId,
      patch: { ownerTeamId: "", productionTeamIds: [] },
    });
    const [after] = await cast.creator.as.query(api.works.listMine, {});
    expect(after).toMatchObject({ ownerTeamId: null, productionTeamIds: [] });
    await cast.admin.as.mutation(api.teams.remove, { id: id("SNS担当") });
  });

  it("一括登録で主管担当・制作担当の ID を受け取る", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const bureau = await cast.admin.as.mutation(api.teams.save, { name: "企画局", kind: "bureau" });
    const ids = await cast.admin.as.mutation(api.works.importBatch, {
      rows: [
        {
          title: "企画案内",
          year: 100,
          purpose: "",
          category: "印刷物",
          mediaType: "pdf" as const,
          creatorIds: [cast.creator.id],
          managerIds: [],
          approverId: cast.approver.id,
          confidentiality: "normal" as const,
          notationCategories: [],
          ownerTeamId: bureau,
          productionTeamIds: [bureau],
        },
      ],
    });
    const work = await t.run((ctx) => ctx.db.get("works", ids[0] as Id<"works">));
    expect(work).toMatchObject({ ownerTeamId: bureau, productionTeamIds: [bureau] });
  });

  it("デモのサンプルデータに組織と担当の割り当てが入る", async () => {
    const t = createHarness();
    process.env.NOGIKU_MOCK_ENABLED = "true";
    await t.mutation(internal.seed.demo, {});
    await t.mutation(internal.seed.demo, {}); // 2 回目は増えない
    const { teams, works } = await t.run(async (ctx) => ({
      teams: await ctx.db.query("teams").collect(),
      works: await ctx.db.query("works").collect(),
    }));
    expect(teams.map((x) => x.name).sort(byText)).toEqual(
      ["広報局", "デザイン担当", "SNS担当", "Web担当", "総務局", "渉外担当", "企画局"].sort(byText),
    );
    const owner = groupWorksByTeam(
      works,
      teams.map((x) => ({ ...x, id: x._id as string })),
      "owner",
    );
    expect(owner.map((g) => g.bureau?.name ?? null)).toEqual(["広報局", null]);
    const production = groupWorksByTeam(
      works,
      teams.map((x) => ({ ...x, id: x._id as string })),
      "production",
    );
    const design = production[0]!.teams.find((g) => g.team?.name === "デザイン担当")!;
    expect(design.works.map((w) => w.legacyId ?? "").sort(byText)).toEqual(["PR-001", "WEB-003"]);
  });
});
