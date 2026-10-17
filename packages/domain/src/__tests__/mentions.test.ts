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
  permission: "view",
  grantedBy: "manager",
  grantedAt: T0,
  ...over,
});
const code = (c: string) => expect.objectContaining({ code: c });

describe("メンション", () => {
  const work = makeWork();
  it("メンションできるのは制作物を見られる人（職責と有効な ACL）だけ", () => {
    const grants = [grant("reviewer", { permission: "review" }), grant("gone", { revokedAt: T0 })];
    expect(mentionableUserIds(work, grants).sort()).toEqual(
      ["approver", "creator", "manager", "reviewer"].sort(),
    );
  });
  it("重複は 1 人にまとめ、見られない人を含むと mention_not_allowed", () => {
    expect(validateMentions(["creator", "creator", "approver"], work, [])).toEqual([
      "creator",
      "approver",
    ]);
    expect(() => validateMentions(["stranger"], work, [])).toThrow(code("mention_not_allowed"));
    expect(() => validateMentions(["gone"], work, [grant("gone", { revokedAt: T0 })])).toThrow(
      code("mention_not_allowed"),
    );
  });
  it(`一度に ${MENTION_MAX} 人まで`, () => {
    const many = Array.from({ length: MENTION_MAX + 1 }, (_, i) => `u${i}`);
    const grants = many.map((id) => grant(id));
    expect(() => validateMentions(many, work, grants)).toThrow(code("mention_too_many"));
    expect(validateMentions(undefined, work, [])).toEqual([]);
  });
});
