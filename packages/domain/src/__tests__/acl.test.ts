import { describe, expect, it } from "vite-plus/test";
import { effectivePermission, type WorkPermissionGrant } from "../acl/Permission.ts";
import { canViewWork, isAllowed } from "../acl/authorize.ts";
import { makeWork } from "./fixtures.ts";

const grant = (over: Partial<WorkPermissionGrant>): WorkPermissionGrant => ({
  workId: "work1",
  principalType: "user",
  principalId: "viewer",
  permission: "view",
  grantedBy: "sysadmin",
  grantedAt: 0,
  ...over,
});
const principal = (userId: string, isSystemAdmin = false) => ({
  userId,
  isSystemAdmin,
  groupIds: [],
  orgPermissions: ["*"],
});

describe("effectivePermission / 個人 ACL（C10, A-01, A-11, A-19, A-20）", () => {
  it("権限のない人は null", () => {
    expect(effectivePermission([grant({})], principal("stranger"))).toBeNull();
  });
  it("剥奪済みの付与は無効", () => {
    expect(
      effectivePermission([grant({ revokedAt: 1, revokedBy: "sysadmin" })], principal("viewer")),
    ).toBeNull();
  });
  it("複数付与は最大レベルを採る", () => {
    expect(
      effectivePermission([grant({}), grant({ permission: "review" })], principal("viewer")),
    ).toBe("review");
  });
  it("グループ付与は principal.groupIds が空（MVP）なら効かない。将来の拡張点", () => {
    const g = grant({ principalType: "group", principalId: "g1", permission: "manage" });
    expect(effectivePermission([g], principal("viewer"))).toBeNull();
    expect(
      effectivePermission([g], {
        userId: "viewer",
        isSystemAdmin: false,
        groupIds: ["g1"],
        orgPermissions: ["*"],
      }),
    ).toBe("manage");
  });
});

describe("isAllowed（§7.2 操作権限）", () => {
  const work = makeWork();
  it("無関係なユーザーは一覧・詳細を見られない", () => {
    expect(canViewWork({ work, grants: [], principal: principal("stranger") })).toBe(false);
  });
  it("システム管理者も ACL/職責が無ければ作品を当然には閲覧できない（§7.2）", () => {
    expect(canViewWork({ work, grants: [], principal: principal("sysadmin", true) })).toBe(false);
  });
  it("view 権限では指摘を投稿できない、review なら可", () => {
    expect(
      isAllowed("comment.post", { work, grants: [grant({})], principal: principal("viewer") }),
    ).toBe(false);
    expect(
      isAllowed("comment.post", {
        work,
        grants: [grant({ permission: "review" })],
        principal: principal("viewer"),
      }),
    ).toBe(true);
  });
  it("校正者は採否を決められない、制作者は決められる", () => {
    expect(
      isAllowed("comment.decide", {
        work,
        grants: [grant({ permission: "review" })],
        principal: principal("viewer"),
      }),
    ).toBe(false);
    expect(isAllowed("comment.decide", { work, grants: [], principal: principal("creator") })).toBe(
      true,
    );
  });
  it("ACL 変更はシステム管理者のみ。校了は校了権限者のみ", () => {
    expect(isAllowed("acl.manage", { work, grants: [], principal: principal("manager") })).toBe(
      false,
    );
    expect(
      isAllowed("acl.manage", { work, grants: [], principal: principal("sysadmin", true) }),
    ).toBe(true);
    expect(
      isAllowed("work.finalize", { work, grants: [], principal: principal("sysadmin", true) }),
    ).toBe(false);
    expect(isAllowed("work.finalize", { work, grants: [], principal: principal("approver") })).toBe(
      true,
    );
  });
});
