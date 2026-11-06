import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

describe("Convex 統合: 自分のアバター（Humation）", () => {
  it("本人が選んだ設定は me と users.avatars に出て、null で消せる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    expect((await cast.creator.as.query(api.me.me, {}))?.avatar).toBeNull();
    const saved = await cast.creator.as.mutation(api.me.setAvatar, {
      avatar: {
        selections: { head: "braids", item: "calico-cat" },
        colors: { hair: "#4a3728" },
        background: "f6f5f4",
      },
    });
    expect(saved).toEqual({
      selections: { head: "braids", item: "calico-cat" },
      colors: { hair: "4A3728" },
      background: "F6F5F4",
    });
    expect((await cast.creator.as.query(api.me.me, {}))?.avatar).toEqual(saved);
    // ほかの人の画面にも、ID をまとめて引けば出る（設定の無い人は返さない）
    expect(
      await cast.reviewer.as.query(api.users.avatars, {
        ids: [cast.creator.id, cast.reviewer.id, "system", "bot:proofreader"],
      }),
    ).toEqual([{ id: cast.creator.id, avatar: saved }]);
    // 本人以外の設定は変わらない
    expect((await cast.reviewer.as.query(api.me.me, {}))?.avatar).toBeNull();
    await cast.creator.as.mutation(api.me.setAvatar, { avatar: null });
    expect((await cast.creator.as.query(api.me.me, {}))?.avatar).toBeNull();
    expect(await cast.reviewer.as.query(api.users.avatars, { ids: [cast.creator.id] })).toEqual([]);
  });

  it("保存済みの値にボトムス（アイコンに映らないので外した）が残っていても、読むときに捨てる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    // 旧クライアントが保存した形（bottom の部位と色を含む）を直接書く
    await t.run((ctx) =>
      ctx.db.patch(cast.creator.id, {
        avatar: {
          selections: { head: "braids", bottom: "wide-pants" },
          colors: { hair: "4A3728", bottom: "000000" },
          background: "F6F5F4",
        },
      }),
    );
    const expected = {
      selections: { head: "braids" },
      colors: { hair: "4A3728" },
      background: "F6F5F4",
    };
    expect((await cast.creator.as.query(api.me.me, {}))?.avatar).toEqual(expected);
    expect(await cast.reviewer.as.query(api.users.avatars, { ids: [cast.creator.id] })).toEqual([
      { id: cast.creator.id, avatar: expected },
    ]);
    // ボトムスだけの旧データは「設定なし」
    await t.run((ctx) =>
      ctx.db.patch(cast.creator.id, { avatar: { selections: { bottom: "wide-pants" } } }),
    );
    expect((await cast.creator.as.query(api.me.me, {}))?.avatar).toBeNull();
    expect(await cast.reviewer.as.query(api.users.avatars, { ids: [cast.creator.id] })).toEqual([]);
  });

  it("形の違う設定は avatar_invalid。未ログインは変えられない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await expect(
      cast.creator.as.mutation(api.me.setAvatar, { avatar: { colors: { hair: "red" } } }),
    ).rejects.toThrow(code("avatar_invalid"));
    await expect(t.mutation(api.me.setAvatar, { avatar: null })).rejects.toThrow(
      code("unauthenticated"),
    );
    await expect(t.query(api.users.avatars, { ids: [cast.creator.id] })).rejects.toThrow(
      code("unauthenticated"),
    );
  });
});
