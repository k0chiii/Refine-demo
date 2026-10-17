import { describe, expect, it } from "vite-plus/test";
import { createHarness } from "../test/harness";
import { upsertNogikuUser } from "./auth.ts";

describe("ログイン時のユーザー反映（upsertNogikuUser）", () => {
  it("本物の OIDC 経路（id なし・sub のみ）でも subject を受け取って作成する", async () => {
    const t = createHarness();
    const id = await t.run((ctx) =>
      upsertNogikuUser(ctx, {
        existingUserId: null,
        profile: { sub: "real-sub", name: "実", orgPermissions: ["works:create"] },
      }),
    );
    const user = await t.run((ctx) => ctx.db.get(id));
    expect(user).toMatchObject({ nogikuSubject: "real-sub", orgPermissions: ["works:create"] });
  });

  it("orgPermissions が undefined のとき保存済みの権限を消さない", async () => {
    const t = createHarness();
    const id = await t.run((ctx) =>
      upsertNogikuUser(ctx, {
        existingUserId: null,
        profile: { sub: "s", orgPermissions: ["works:create", "reviews:assign"] },
      }),
    );
    await t.run((ctx) => upsertNogikuUser(ctx, { existingUserId: id, profile: { sub: "s" } }));
    expect((await t.run((ctx) => ctx.db.get(id)))?.orgPermissions).toEqual([
      "works:create",
      "reviews:assign",
    ]);
  });

  it("空配列は「何も持っていない」として保存値を置き換える", async () => {
    const t = createHarness();
    const id = await t.run((ctx) =>
      upsertNogikuUser(ctx, {
        existingUserId: null,
        profile: { sub: "s", orgPermissions: ["works:create"] },
      }),
    );
    await t.run((ctx) =>
      upsertNogikuUser(ctx, { existingUserId: id, profile: { sub: "s", orgPermissions: [] } }),
    );
    expect((await t.run((ctx) => ctx.db.get(id)))?.orgPermissions).toEqual([]);
  });

  it("モックの経路（id のみ）も動く", async () => {
    const t = createHarness();
    const id = await t.run((ctx) =>
      upsertNogikuUser(ctx, { existingUserId: null, profile: { id: "mock-1", name: "m" } }),
    );
    expect((await t.run((ctx) => ctx.db.get(id)))?.nogikuSubject).toBe("mock-1");
  });
});
