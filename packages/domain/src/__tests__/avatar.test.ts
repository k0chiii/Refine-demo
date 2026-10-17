import { describe, expect, it } from "vite-plus/test";
import {
  DomainError,
  parseAvatarConfig,
  sameAvatarConfig,
  validateAvatarConfig,
} from "../index.ts";

describe("アバターの設定（形の検証と正規化）", () => {
  it("部位・色・背景を正規化して返す（色は # 無しの大文字）", () => {
    expect(
      validateAvatarConfig({
        selections: { head: "braids", item: "calico-cat" },
        colors: { hair: "#4a3728", skin: "ffeecc" },
        background: "#f6f5f4",
      }),
    ).toEqual({
      selections: { head: "braids", item: "calico-cat" },
      colors: { hair: "4A3728", skin: "FFEECC" },
      background: "F6F5F4",
    });
  });

  it("空の設定は null（＝設定なし。メールから決まる絵に戻る）", () => {
    expect(validateAvatarConfig(null)).toBeNull();
    expect(validateAvatarConfig(undefined)).toBeNull();
    expect(validateAvatarConfig({})).toBeNull();
    expect(validateAvatarConfig({ selections: {}, colors: {} })).toBeNull();
  });

  it("形の違う値は avatar_invalid（部品の名前・色・長さ・個数）", () => {
    const bad: unknown[] = [
      [],
      "x",
      { seed: "" },
      { seed: "a".repeat(121) },
      { selections: ["head"] },
      { selections: { head: "Braids" } },
      { selections: { "<img>": "braids" } },
      { selections: { head: "a".repeat(80) } },
      { colors: { hair: "red" } },
      { colors: { hair: "#fff" } },
      { background: "transparent" },
      { colors: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`c${i}`, "000000"])) },
    ];
    for (const b of bad)
      expect(() => validateAvatarConfig(b), JSON.stringify(b)).toThrow(DomainError);
    try {
      validateAvatarConfig({ colors: { hair: "red" } });
    } catch (e) {
      expect((e as DomainError).code).toBe("avatar_invalid");
      expect((e as DomainError).details).toEqual({ field: "colors", reason: "value" });
    }
  });

  it("保存済みの値は寛容に読む（壊れた項目だけ捨てる）", () => {
    expect(
      parseAvatarConfig({
        seed: "x",
        selections: { head: "braids", body: "Bad Name", 1: "tee" },
        colors: { hair: "#123456", skin: "red" },
        background: "nope",
        extra: true,
      }),
    ).toEqual({
      seed: "x",
      selections: { head: "braids", "1": "tee" },
      colors: { hair: "123456" },
    });
    expect(parseAvatarConfig({ colors: { hair: "red" } })).toBeNull();
    expect(parseAvatarConfig("junk")).toBeNull();
    expect(parseAvatarConfig(undefined)).toBeNull();
  });

  it("同じ設定かは並び順によらない", () => {
    expect(
      sameAvatarConfig(
        { selections: { head: "a", body: "b" }, colors: { hair: "000000" } },
        { colors: { hair: "000000" }, selections: { body: "b", head: "a" } },
      ),
    ).toBe(true);
    expect(sameAvatarConfig({ selections: { head: "a" } }, { selections: { head: "b" } })).toBe(
      false,
    );
    expect(sameAvatarConfig(null, { seed: "x" })).toBe(false);
    expect(sameAvatarConfig(null, null)).toBe(true);
  });
});
