import { describe, expect, it } from "vite-plus/test";
import type { WorkPermissionGrant } from "../acl/Permission.ts";
import { MENTION_MAX, mentionableUserIds, validateMentions } from "../comment/mentions.ts";
import { makeWork, T0 } from "./fixtures.ts";

const grant = (
  principalId: string,
  over: Partial<WorkPermissionGrant> = {},
): WorkPermissionGrant => ({
  workId: "work1",
  principalType: "user",
  principalId,
  permission: "review",
  grantedBy: "manager",
  grantedAt: T0,
  ...over,
});
const code = (c: string) => expect.objectContaining({ code: c });

describe("メンション", () => {
  const work = makeWork();
  it("メンションできるのは制作物に関わる人（職責と有効な ACL）", () => {
    const grants = [grant("reviewer", { permission: "review" }), grant("gone", { revokedAt: T0 })];
    expect(mentionableUserIds(work, grants).sort()).toEqual(
      ["approver", "creator", "manager", "reviewer"].sort(),
    );
  });
  it("関係者と、制作物の担当に所属する人も候補（利用者決定 2026-10-17）。ほかの担当の所属は入らない", () => {
    const w = makeWork({
      stakeholderIds: ["stake"],
      productionTeamIds: ["design"],
    });
    const teams = [
      { id: "design", memberIds: ["member", "creator"] },
      { id: "sys", memberIds: ["other"] },
    ];
    expect(mentionableUserIds(w, [], teams).sort()).toEqual(
      ["approver", "creator", "manager", "member", "stake"].sort(),
    );
    expect(validateMentions(["member"], w, [], teams)).toEqual(["member"]);
    expect(validateMentions(["other"], w, [], teams)).toEqual(["other"]);
  });
  it("重複は 1 人にまとめる。委員なら誰でもメンションできる（105A）", () => {
    expect(validateMentions(["creator", "creator", "approver"], work, [])).toEqual([
      "creator",
      "approver",
    ]);
    expect(validateMentions(["stranger"], work, [])).toEqual(["stranger"]);
    expect(validateMentions(["gone"], work, [grant("gone", { revokedAt: T0 })])).toEqual(["gone"]);
  });
  it("通常の制作物は委員の誰でも見られる（既定のポリシー）ので、ここでは上限と重複だけを見る", () => {
    const normal = makeWork();
    expect(validateMentions(["stranger", "stranger"], normal, [])).toEqual(["stranger"]);
    // 候補の一覧は関わる人（名簿の全員はアプリケーション層が引く）
    expect(mentionableUserIds(normal, []).sort()).toEqual(["approver", "creator", "manager"]);
  });
  it(`一度に ${MENTION_MAX} 人まで`, () => {
    const many = Array.from({ length: MENTION_MAX + 1 }, (_, i) => `u${i}`);
    const grants = many.map((id) => grant(id));
    expect(() => validateMentions(many, work, grants)).toThrow(code("mention_too_many"));
    expect(() => validateMentions(many, makeWork(), [])).toThrow(code("mention_too_many"));
    expect(validateMentions(undefined, work, [])).toEqual([]);
  });
});
