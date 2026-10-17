import { describe, expect, it } from "vite-plus/test";
import {
  AVATAR_COLOR_SLOTS,
  AVATAR_PART_SLOTS,
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

  it("アイコンに映らない部位・色（ボトムス）は形から外した（利用者指示 2026-10-17）", () => {
    expect(AVATAR_PART_SLOTS).toEqual(["head", "body", "item", "glasses"]);
    expect(AVATAR_COLOR_SLOTS).toEqual(["hair", "skin", "clothes", "stroke"]);
  });

  it("外した部位・役割（bottom）や知らない名前は、検証を失敗にせず黙って捨てる（古いクライアント・保存済みの値）", () => {
    expect(
      validateAvatarConfig({
        selections: { head: "braids", bottom: "wide-pants", hat: "x" },
        colors: { hair: "000000", bottom: "#123456", eyes: "ffffff" },
      }),
    ).toEqual({ selections: { head: "braids" }, colors: { hair: "000000" } });
    // 捨てる項目しか無ければ「設定なし」
    expect(
      validateAvatarConfig({ selections: { bottom: "wide-pants" }, colors: { bottom: "000000" } }),
    ).toBeNull();
    // 捨てる項目の値が壊れていても失敗にしない
    expect(validateAvatarConfig({ colors: { bottom: "red" }, background: "F6F5F4" })).toEqual({
      background: "F6F5F4",
    });
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

  it("保存済みの値は寛容に読む（壊れた項目と、外した部位・役割だけ捨てる）", () => {
    expect(
      parseAvatarConfig({
        seed: "x",
        selections: { head: "braids", body: "Bad Name", item: "tee", bottom: "wide-pants", 1: "x" },
        colors: { hair: "#123456", skin: "red", bottom: "000000" },
        background: "nope",
        extra: true,
      }),
    ).toEqual({
      seed: "x",
      selections: { head: "braids", item: "tee" },
      colors: { hair: "123456" },
    });
    // 旧データ（ボトムスだけ）は「設定なし」として読める
    expect(
      parseAvatarConfig({ selections: { bottom: "wide-pants" }, colors: { bottom: "000000" } }),
    ).toBeNull();
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
