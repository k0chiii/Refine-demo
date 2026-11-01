import { describe, expect, it } from "vite-plus/test";
import { hasOrgPermission, orgPermissionCatalog } from "../acl/OrgPermission.ts";
import { effectivePermission, type WorkPermissionGrant } from "../acl/Permission.ts";
import {
  canViewWork,
  isAllowed,
  isInvolvedInWork,
  workTeamIdsOf,
  type WorkAction,
} from "../acl/authorize.ts";
import { makeWork } from "./fixtures.ts";

const grant = (over: Partial<WorkPermissionGrant>): WorkPermissionGrant => ({
  workId: "work1",
  principalType: "user",
  principalId: "viewer",
  permission: "review",
  grantedBy: "sysadmin",
  grantedAt: 0,
  ...over,
});
const principal = (userId: string, isSystemAdmin = false, teamIds: string[] = []) => ({
  userId,
  isSystemAdmin,
  groupIds: [],
  orgPermissions: ["*"],
  teamIds,
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

describe("閲覧（105A: サインインした委員はすべての制作物を見られる）", () => {
  const work = makeWork();

  it("関係のない委員も見られる", () => {
    expect(canViewWork({ work, grants: [], principal: principal("stranger") })).toBe(true);
    expect(isAllowed("work.view", { work, grants: [], principal: principal("stranger") })).toBe(
      true,
    );
  });

  it("関係者・所属は閲覧とコメントまで。校正への参加・編集・割当・校了・ACL の規則は変わらない", () => {
    const involved = makeWork({ stakeholderIds: ["stake"], productionTeamIds: ["design"] });
    for (const who of [principal("stake"), principal("member", false, ["design"])]) {
      const ctx = { work: involved, grants: [], principal: who };
      expect(isAllowed("comment.post", ctx)).toBe(true);
      expect(isAllowed("review.participate", ctx)).toBe(false);
      expect(isAllowed("work.edit", ctx)).toBe(false);
      expect(isAllowed("revision.submit", ctx)).toBe(false);
      expect(isAllowed("review.assign", ctx)).toBe(false);
      expect(isAllowed("work.finalize", ctx)).toBe(false);
      expect(isAllowed("acl.manage", ctx)).toBe(false);
    }
    const stranger = { work: involved, grants: [], principal: principal("stranger") };
    expect(isAllowed("comment.post", stranger)).toBe(true);
    expect(isAllowed("review.participate", stranger)).toBe(false);
  });

  it("関係者・担当所属の判定（isInvolvedInWork）は閲覧以外で使う", () => {
    const workWithTeams = makeWork({
      stakeholderIds: ["stake"],
      ownerTeamId: "pr",
      productionTeamIds: ["design"],
      relatedTeamIds: ["jim"],
    });
    expect(workTeamIdsOf(workWithTeams)).toEqual(["pr", "design", "jim"]);
    expect(isInvolvedInWork(workWithTeams, principal("stake"))).toBe(true);
    for (const team of ["pr", "design", "jim"])
      expect(isInvolvedInWork(workWithTeams, principal("member", false, [team]))).toBe(true);
    expect(isInvolvedInWork(workWithTeams, principal("other", false, ["sys"]))).toBe(false);
  });
});

describe("isAllowed（§7.2 操作権限）", () => {
  const work = makeWork();
  it("コメントは見られる人なら誰でも", () => {
    expect(isAllowed("comment.post", { work, grants: [], principal: principal("stranger") })).toBe(
      true,
    );
  });
  it("校正への参加（review.participate）は review 以上の ACL か職責のみ", () => {
    const ctxOf = (who: string, grants: WorkPermissionGrant[] = []) => ({
      work,
      grants,
      principal: principal(who),
    });
    expect(isAllowed("review.participate", ctxOf("viewer", []))).toBe(false);
    expect(
      isAllowed("review.participate", ctxOf("viewer", [grant({ permission: "review" })])),
    ).toBe(true);
    for (const who of ["creator", "approver", "manager"]) {
      expect(isAllowed("review.participate", ctxOf(who, []))).toBe(true);
    }
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
  it("ACL 変更はシステム管理者のみ。校了は校了権限者（とシステム管理者）", () => {
    expect(isAllowed("acl.manage", { work, grants: [], principal: principal("manager") })).toBe(
      false,
    );
    expect(
      isAllowed("acl.manage", { work, grants: [], principal: principal("sysadmin", true) }),
    ).toBe(true);
    expect(isAllowed("work.finalize", { work, grants: [], principal: principal("manager") })).toBe(
      false,
    );
    expect(isAllowed("work.finalize", { work, grants: [], principal: principal("approver") })).toBe(
      true,
    );
  });
});

describe("システム管理者はすべての操作権限を持つ（利用者決定 2026-10-30）", () => {
  const actions = Object.keys({
    "work.view": true,
    "work.edit": true,
    "revision.submit": true,
    "comment.post": true,
    "comment.reply": true,
    "review.participate": true,
    "comment.decide": true,
    "review.assign": true,
    "work.finalize": true,
    "work.reopen": true,
    "approval.confirm": true,
    "acl.manage": true,
    "audit.view": true,
  } satisfies Record<WorkAction, true>) as WorkAction[];
  const work = makeWork();
  const admin = { ...principal("sysadmin", true), orgPermissions: [] };
  const stranger = { ...principal("stranger"), orgPermissions: [] };

  it("職責・ACL・所属が無い制作物でも、すべての操作が許される", () => {
    for (const action of actions)
      expect(isAllowed(action, { work, grants: [], principal: admin }), action).toBe(true);
  });

  it("組織権限は Nogiku Access から何も渡されていなくても、すべて持つ", () => {
    for (const { name } of orgPermissionCatalog)
      expect(hasOrgPermission(admin, name), name).toBe(true);
  });

  it("管理者でない無関係な人は、閲覧とコメント以外は拒否される", () => {
    expect(canViewWork({ work, grants: [], principal: stranger })).toBe(true);
    expect(isAllowed("comment.post", { work, grants: [], principal: stranger })).toBe(true);
    expect(isAllowed("work.edit", { work, grants: [], principal: stranger })).toBe(false);
    for (const { name } of orgPermissionCatalog)
      expect(hasOrgPermission(stranger, name), name).toBe(false);
  });
});
