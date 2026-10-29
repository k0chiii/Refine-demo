import { describe, expect, it } from "vite-plus/test";
import { canManageGroups } from "../acl/OrgPermission.ts";
import type { Principal } from "../acl/Permission.ts";

const principal = (isSystemAdmin: boolean, orgPermissions: string[]): Principal => ({
  userId: "u",
  isSystemAdmin,
  groupIds: [],
  orgPermissions,
});

describe("メンションのグループを作れる人（利用者指示 2026-10-29。組織権限 groups:manage）", () => {
  it("groups:manage を持つ人と、Nogiku Access 未接続（*）の人はできる", () => {
    expect(canManageGroups(principal(false, ["groups:manage"]))).toBe(true);
    expect(canManageGroups(principal(false, ["*"]))).toBe(true);
  });
  it("システム管理者は権限が無くてもできる。どちらでもない人はできない", () => {
    expect(canManageGroups(principal(true, []))).toBe(true);
    expect(canManageGroups(principal(false, ["works:create", "approvers:assign"]))).toBe(false);
  });
});
