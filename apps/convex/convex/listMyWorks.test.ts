import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import { listMyWorks } from "./works.ts";

/**
 * 自分が見られる制作物の集め方（works.listMyWorks。docs/UI_M3E.md §60「後続（Convex のクエリ）」）。
 * 通常の制作物は `by_confidentiality` の索引で ACL を読まずに集め、非公開だけ ACL と担当の所属で判定する。
 * 全走査していたときと、結果も並び（作成時刻の昇順）も同じであること。
 */
describe("Convex: works.listMyWorks（索引で集める）", () => {
  async function seed() {
    const t = createHarness();
    const cast = await createCast(t);
    const team = await cast.admin.as.mutation(api.teams.save, {
      name: "広報局",
      kind: "bureau",
      code: "PR",
      memberIds: [cast.stranger.id],
    });
    const base = {
      purpose: "",
      category: "印刷物",
      mediaType: "pdf" as const,
      year: 100,
      creatorIds: [cast.creator.id],
      approverId: cast.approver.id,
    };
    const ids: Id<"works">[] = [];
    // 通常・非公開を交互に作る（並びの確認のため）
    for (const [i, conf] of (
      ["normal", "restricted", "normal", "restricted", "restricted"] as const
    ).entries()) {
      ids.push(
        (await cast.manager.as.mutation(api.works.create, {
          ...base,
          title: `制作物 ${i}`,
          confidentiality: conf,
          // 3 番目の非公開は広報局の担当（所属する stranger が見られる）、4 番目は reviewer が関係者
          ...(i === 3 ? { ownerTeamId: team } : {}),
          ...(i === 4 ? { stakeholderIds: [cast.reviewer.id] } : {}),
        })) as Id<"works">,
      );
    }
    return { t, cast, ids, team };
  }

  it("通常は委員の誰でも、非公開は職責・関係者・担当の所属がある人とシステム管理者だけ。並びは作成順", async () => {
    const { cast, ids } = await seed();
    const mine = async (who: (typeof cast)[keyof typeof cast]) =>
      (await who.as.query(api.works.listMine, {})).map((w) => w.id);
    // listMine は締切 → 題名の順。ここでは題名が作成順なのでそのまま比べられる
    expect(await mine(cast.manager)).toEqual(ids); // 主管は全部
    expect(await mine(cast.admin)).toEqual(ids); // システム管理者は全部（利用者決定 2026-10-30）
    expect(await mine(cast.stranger)).toEqual([ids[0], ids[2], ids[3]]); // 担当の所属
    expect(await mine(cast.reviewer)).toEqual([ids[0], ids[2], ids[4]]); // 関係者
  });

  it("listMyWorks の並びは全走査（_creationTime 昇順）と同じ。involved_only なら通常の制作物も関わる人だけ", async () => {
    const { t, cast, ids } = await seed();
    const principal = (userId: Id<"users">) => ({
      userId,
      isSystemAdmin: false,
      groupIds: [],
      orgPermissions: ["*"],
    });
    const order = await t.run(async (ctx) =>
      (await listMyWorks(ctx.db, principal(cast.stranger.id))).map((w) => w.id),
    );
    expect(order).toEqual([ids[0], ids[2], ids[3]]);
    const scanned = await t.run(async (ctx) =>
      (await ctx.db.query("works").collect())
        .filter((d) => d.confidentiality === "normal" || d.ownerTeamId !== undefined)
        .map((d) => d._id),
    );
    expect(order).toEqual(scanned);
    // ポリシーを関わる人だけに戻すと、通常の制作物も職責・ACL・関係者・所属がある人だけ
    const involved = await t.run(async (ctx) =>
      (
        await listMyWorks(ctx.db, principal(cast.stranger.id), { normalWorks: "involved_only" })
      ).map((w) => w.id),
    );
    expect(involved).toEqual([ids[3]]);
    const creator = await t.run(async (ctx) =>
      (await listMyWorks(ctx.db, principal(cast.creator.id), { normalWorks: "involved_only" })).map(
        (w) => w.id,
      ),
    );
    expect(creator).toEqual(ids);
  });
});
