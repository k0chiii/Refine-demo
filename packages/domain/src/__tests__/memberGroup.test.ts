import { describe, expect, it } from "vite-plus/test";
import { personDisplayName, personMatchesText, toHiragana } from "../account/personName.ts";
import {
  MENTION_GROUP_MAX,
  groupMentionToken,
  resolveGroupMentions,
  splitMentionTokens,
} from "../comment/mentions.ts";
import {
  MEMBER_GROUP_MEMBER_MAX,
  expandMemberGroups,
  searchMemberGroups,
  sortMemberGroups,
  validateMemberGroup,
  type MemberGroup,
} from "../org/group.ts";
import { makeWork, T0 } from "./fixtures.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const group = (id: string, name: string, memberIds: string[], order = 1): MemberGroup => ({
  id,
  name,
  memberIds,
  order,
  updatedAt: T0,
  updatedBy: "admin",
});

describe("名前はふりがな（ひらがな）で出し、ひらがな・カタカナ・漢字のどれでも探せる", () => {
  it("ふりがながあればそれを出し、カタカナ・半角はひらがなにそろえる。無ければ漢字の名前", () => {
    expect(personDisplayName({ name: "本郷 校正", hurigana: "ほんごう こうせい" })).toBe(
      "ほんごう こうせい",
    );
    expect(personDisplayName({ name: "本郷 校正", hurigana: "ホンゴウ　コウセイ" })).toBe(
      "ほんごう こうせい",
    );
    expect(personDisplayName({ name: "本郷 校正", hurigana: "ﾎﾝｺﾞｳ" })).toBe("ほんごう");
    expect(personDisplayName({ name: "本郷 校正", hurigana: "  " })).toBe("本郷 校正");
    expect(personDisplayName({})).toBe("");
    expect(toHiragana("ヴァイオリン ABC")).toBe("ゔぁいおりん ABC");
  });
  it("検索はふりがな・漢字の名前・メールのどれでも。カタカナで打っても、空白を挟まなくても当たる", () => {
    const p = { name: "本郷 校正", hurigana: "ほんごう こうせい", email: "Hongo@example.invalid" };
    for (const q of ["ほんごう", "ホンゴウ", "ほんごうこうせい", "本郷", "hongo", "", "  "])
      expect(personMatchesText(p, q)).toBe(true);
    expect(personMatchesText(p, "こまば")).toBe(false);
  });
});

describe("メンバーのグループ", () => {
  it("名前は必須・30 文字まで・「@」は使えず、同じ名前（ゆれは無視）は作れない。所属の重なりは 1 人に", () => {
    const existing = [group("g1", "こうせいはん", ["a"])];
    expect(
      validateMemberGroup({ name: "  デザイン  班 ", memberIds: ["a", "b", "a"] }, existing),
    ).toEqual({ name: "デザイン 班", memberIds: ["a", "b"], order: 2 });
    expect(() => validateMemberGroup({ name: " ", memberIds: [] }, [])).toThrow(
      code("group_invalid"),
    );
    expect(() => validateMemberGroup({ name: "あ".repeat(31), memberIds: [] }, [])).toThrow(
      code("group_invalid"),
    );
    expect(() => validateMemberGroup({ name: "@校正", memberIds: [] }, [])).toThrow(
      code("group_invalid"),
    );
    expect(() => validateMemberGroup({ name: "こうせいはん", memberIds: [] }, existing)).toThrow(
      code("group_duplicate"),
    );
    // 自分自身の名前はそのまま保存できる
    expect(validateMemberGroup({ name: "こうせいはん", memberIds: [] }, existing, "g1").name).toBe(
      "こうせいはん",
    );
    const many = Array.from({ length: MEMBER_GROUP_MEMBER_MAX + 1 }, (_, i) => `u${i}`);
    expect(() => validateMemberGroup({ name: "大勢", memberIds: many }, [])).toThrow(
      code("group_invalid"),
    );
    expect(() => validateMemberGroup({ name: "空", memberIds: [" "] }, [])).toThrow(
      code("group_invalid"),
    );
  });
  it("並び順 → 名前の順に並べ、名前の途中・カタカナでも探せる。所属する人は重なりなくまとめる", () => {
    const groups = [group("g2", "こうほう", ["c"], 2), group("g1", "こうせいはん", ["a", "b"], 1)];
    expect(sortMemberGroups(groups).map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(searchMemberGroups(groups, "コウセイ").map((g) => g.id)).toEqual(["g1"]);
    expect(searchMemberGroups(groups, "").map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(expandMemberGroups(["g1", "g2", "nope"], [...groups, group("g3", "x", ["a"])])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("グループのメンション", () => {
  const groups = [
    group("g1", "こうせいはん", ["reviewer", "approver", "outsider"]),
    group("g2", "ほか", ["creator"]),
  ];
  it("「group:ID」を人の ID と分ける", () => {
    expect(splitMentionTokens(["u1", groupMentionToken("g1"), "u1", "group:", "group:g1"])).toEqual(
      { userIds: ["u1"], groupIds: ["g1"] },
    );
  });
  it("グループのメンションは所属者全員（書いた本人は外す）", () => {
    const work = makeWork();
    expect(resolveGroupMentions(["g1"], groups, work, [], [], "approver")).toEqual([
      "reviewer",
      "outsider",
    ]);
  });
  it("所属する人全員。知らないグループ・グループの数の上限は拒否", () => {
    const work = makeWork();
    expect(resolveGroupMentions(["g1", "g2"], groups, work, [])).toEqual([
      "reviewer",
      "approver",
      "outsider",
      "creator",
    ]);
    expect(() => resolveGroupMentions(["zz"], groups, work, [])).toThrow(
      code("mention_not_allowed"),
    );
    const ids = Array.from({ length: MENTION_GROUP_MAX + 1 }, (_, i) => `g${i}`);
    expect(() => resolveGroupMentions(ids, groups, work, [])).toThrow(code("mention_too_many"));
  });
});
