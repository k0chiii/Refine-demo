import { describe, expect, it } from "vite-plus/test";
import {
  parseTeamCsv,
  parseWorkCsv,
  resolveWorkImport,
  teamCsvTemplate,
  TEAM_MAX,
} from "@mf100/domain";
import { deleteTeam, importTeams, listTeams, saveTeam } from "../usecases/teams.ts";
import { importWorks, updateWork } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

async function setup() {
  const ctx = createInMemoryContext();
  const pr = await saveTeam(ctx, principals.sysadmin, {
    name: "広報局",
    kind: "bureau",
    code: "PR",
  });
  const design = await saveTeam(ctx, principals.sysadmin, {
    name: "デザイン担当",
    kind: "team",
    parentId: pr.id,
  });
  const sns = await saveTeam(ctx, principals.sysadmin, {
    name: "SNS担当",
    kind: "team",
    parentId: pr.id,
  });
  return { ctx, pr, design, sns };
}

describe("組織（局 › 担当）の管理", () => {
  it("システム管理者だけが登録・変更・削除でき、誰でも並んだ一覧を見られる。監査を残す", async () => {
    const { ctx, pr, design, sns } = await setup();
    await expect(
      saveTeam(ctx, principals.manager, { name: "総務局", kind: "bureau" }),
    ).rejects.toThrow(code("forbidden"));
    await expect(deleteTeam(ctx, principals.manager, sns.id)).rejects.toThrow(code("forbidden"));
    const soumu = await saveTeam(ctx, principals.sysadmin, {
      name: "総務局",
      kind: "bureau",
      order: 0,
    });
    expect((await listTeams(ctx, principals.creator)).map((t) => t.name)).toEqual([
      "総務局",
      "広報局",
      "デザイン担当",
      "SNS担当",
    ]);
    // 名前だけ変えると並び順はそのまま
    const renamed = await saveTeam(ctx, principals.sysadmin, {
      id: design.id,
      name: "デザイン・印刷担当",
      kind: "team",
      parentId: pr.id,
    });
    expect(renamed).toMatchObject({ name: "デザイン・印刷担当", order: design.order });
    // 別の局へ移す
    const moved = await saveTeam(ctx, principals.sysadmin, {
      id: sns.id,
      name: "SNS担当",
      kind: "team",
      parentId: soumu.id,
    });
    expect(moved.parentId).toBe(soumu.id);
    await deleteTeam(ctx, principals.sysadmin, moved.id);
    expect((await listTeams(ctx, principals.creator)).map((t) => t.id)).not.toContain(sns.id);
    expect(ctx.state.audit.filter((a) => a.entityType === "team").map((a) => a.operation)).toEqual([
      "create",
      "create",
      "create",
      "create",
      "update",
      "update",
      "delete",
    ]);
    await expect(
      saveTeam(ctx, principals.sysadmin, { id: "nope", name: "x", kind: "bureau" }),
    ).rejects.toThrow(code("team_not_found"));
    await expect(
      saveTeam(ctx, principals.sysadmin, {
        name: "デザイン・印刷担当",
        kind: "team",
        parentId: pr.id,
      }),
    ).rejects.toThrow(code("team_duplicate"));
  });

  it("制作物が使っている局・担当と、担当がある局は消せず、種類も変えられない", async () => {
    const { ctx, pr, design, sns } = await setup();
    await seedWork(ctx, { ownerTeamId: design.id });
    await expect(deleteTeam(ctx, principals.sysadmin, design.id)).rejects.toThrow(
      code("team_in_use"),
    );
    await expect(deleteTeam(ctx, principals.sysadmin, pr.id)).rejects.toThrow(code("team_in_use"));
    const soumu = await saveTeam(ctx, principals.sysadmin, { name: "総務局", kind: "bureau" });
    await expect(
      saveTeam(ctx, principals.sysadmin, {
        id: pr.id,
        name: "広報局",
        kind: "team",
        parentId: soumu.id,
      }),
    ).rejects.toThrow(code("team_invalid"));
    await expect(
      saveTeam(ctx, principals.sysadmin, { id: design.id, name: "デザイン担当", kind: "bureau" }),
    ).rejects.toThrow(code("team_invalid"));
    // 制作担当で使っていても消せない
    const work = await seedWork(ctx, { productionTeamIds: [sns.id] });
    await expect(deleteTeam(ctx, principals.sysadmin, sns.id)).rejects.toThrow(code("team_in_use"));
    await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { productionTeamIds: [] },
    });
    // 使われていない担当は局に変えられる
    const promoted = await saveTeam(ctx, principals.sysadmin, {
      id: sns.id,
      name: "SNS局",
      kind: "bureau",
    });
    expect(promoted).toMatchObject({ kind: "bureau" });
    expect(promoted.parentId).toBeUndefined();
    // もう無いものを消すのは何もしない
    await deleteTeam(ctx, principals.sysadmin, "nope");
  });

  it(`登録は ${TEAM_MAX} 件まで`, async () => {
    const ctx = createInMemoryContext();
    for (let i = 0; i < TEAM_MAX; i++)
      await ctx.teams.insert({
        name: `局${i}`,
        kind: "bureau",
        order: i,
        updatedAt: 0,
        updatedBy: "x",
      });
    await expect(
      saveTeam(ctx, principals.sysadmin, { name: "もう一つ", kind: "bureau" }),
    ).rejects.toThrow(code("team_invalid"));
  });
});

describe("組織の CSV の取り込み", () => {
  it("無い局・担当だけを局から先に作り、何度取り込んでも二重にならない。監査は一括で 1 件", async () => {
    const { ctx } = await setup();
    // 雛形は Notion の担当 DB の列名（局はコード PR・JIM、絵文字・ユーザ）。PR はもうある広報局にコードで当たる
    const rows = parseTeamCsv(
      [teamCsvTemplate().trim(), "企画局,,3,,", "財務局,会計担当,,,"].join("\r\n"),
    ).rows;
    await expect(importTeams(ctx, principals.manager, rows)).rejects.toThrow(code("forbidden"));
    expect(await importTeams(ctx, principals.sysadmin, rows)).toEqual({ created: 5, existing: 2 });
    const list = await listTeams(ctx, principals.creator);
    const path = (id: string | undefined) => list.find((t) => t.id === id)?.name;
    expect(list.map((t) => (t.parentId ? `${path(t.parentId)} › ${t.name}` : t.name))).toEqual([
      "広報局",
      "広報局 › デザイン担当",
      "広報局 › SNS担当",
      "JIM",
      "JIM › 渉外担当",
      "企画局",
      "財務局",
      "財務局 › 会計担当",
    ]);
    // 「局」がコードだけなら、名前もコードの局を作り code を付ける（名前は管理画面で直す）。担当の絵文字も入る
    expect(list.find((t) => t.name === "JIM")).toMatchObject({ kind: "bureau", code: "JIM" });
    expect(list.find((t) => t.name === "渉外担当")).not.toHaveProperty("emoji");
    expect(list.find((t) => t.name === "財務局")).not.toHaveProperty("code");
    expect(await importTeams(ctx, principals.sysadmin, rows)).toEqual({
      created: 0,
      existing: rows.length,
    });
    expect(ctx.state.audit.filter((a) => a.operation === "bulk_import")).toHaveLength(2);
    await expect(importTeams(ctx, principals.sysadmin, [])).rejects.toThrow(code("team_invalid"));
  });
});

describe("制作物の主管担当・制作担当", () => {
  it("登録・変更では組織にある局・担当だけを指せる。空の主管担当は外す。制作担当は置き換え（重複は除く。1 つまで）", async () => {
    const { ctx, pr, design, sns } = await setup();
    await expect(seedWork(ctx, { ownerTeamId: "nope" })).rejects.toThrow(code("team_not_found"));
    await expect(seedWork(ctx, { productionTeamIds: ["nope"] })).rejects.toThrow(
      code("team_not_found"),
    );
    const blank = await seedWork(ctx, { ownerTeamId: "", productionTeamIds: [""] });
    expect(blank.ownerTeamId).toBeUndefined();
    expect(blank.productionTeamIds).toEqual([]);

    const work = await seedWork(ctx, { ownerTeamId: design.id, productionTeamIds: [design.id] });
    expect(work).toMatchObject({ ownerTeamId: design.id, productionTeamIds: [design.id] });
    const changed = await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { ownerTeamId: pr.id, productionTeamIds: [sns.id, sns.id] },
    });
    expect(changed).toMatchObject({ ownerTeamId: pr.id, productionTeamIds: [sns.id] });
    await expect(
      updateWork(ctx, principals.manager, { workId: work.id, patch: { ownerTeamId: "nope" } }),
    ).rejects.toThrow(code("team_not_found"));
    // 空文字は「主管担当なし」
    const cleared = await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { ownerTeamId: "", productionTeamIds: [] },
    });
    expect(cleared.ownerTeamId).toBeUndefined();
    expect(cleared.productionTeamIds).toEqual([]);
    expect((await ctx.works.findById(work.id))!.ownerTeamId).toBeUndefined();
    // 主管担当を省略した変更では今の値のまま
    const kept = await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { ownerTeamId: design.id },
    });
    const untouched = await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { title: "題名だけ" },
    });
    expect(untouched.ownerTeamId).toBe(kept.ownerTeamId);
  });

  it("一括登録: CSV の主管担当・制作担当を照合した ID で登録する。無い ID は 1 件も登録しない", async () => {
    const { ctx, design, sns } = await setup();
    const parsed = parseWorkCsv(
      [
        "題名,区分,媒体,制作者,校了権限者,主管担当,制作担当",
        `A,印刷物,PDF,creator,approver,広報局 › デザイン担当,広報局/SNS担当`,
      ].join("\n"),
      { defaultYear: 100, now: ctx.clock.now() },
    );
    const directory = [
      { id: principals.creator.userId, name: "creator", email: null },
      { id: principals.approver.userId, name: "approver", email: null },
    ];
    const preview = resolveWorkImport(
      parsed,
      directory,
      {},
      await listTeams(ctx, principals.sysadmin),
    );
    expect(preview.ready).toBe(1);
    const [created] = await importWorks(ctx, principals.sysadmin, {
      rows: [preview.rows[0]!.input!],
    });
    expect(created).toMatchObject({
      ownerTeamId: design.id,
      productionTeamIds: [sns.id],
    });
    await expect(
      importWorks(ctx, principals.sysadmin, {
        rows: [preview.rows[0]!.input!, { ...preview.rows[0]!.input!, ownerTeamId: "nope" }],
      }),
    ).rejects.toThrow(code("team_not_found"));
  });
});
