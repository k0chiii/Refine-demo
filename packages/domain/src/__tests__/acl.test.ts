import { describe, expect, it } from "vite-plus/test";
import { hasOrgPermission, orgPermissionCatalog } from "../acl/OrgPermission.ts";
import { effectivePermission, type WorkPermissionGrant } from "../acl/Permission.ts";
import {
  allMembersCanView,
  canViewWork,
  isAllowed,
  isInvolvedInWork,
  workTeamIdsOf,
  type WorkAction,
} from "../acl/authorize.ts";
import { defaultWorkViewPolicy, type WorkViewPolicy } from "../acl/WorkViewPolicy.ts";
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
const involvedOnly: WorkViewPolicy = { normalWorks: "involved_only" };

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

describe("閲覧範囲（D3 の細則。利用者決定 2026-10-17「閲覧は基本全員できて良い」）", () => {
  const normal = makeWork();
  const restricted = makeWork({ confidentiality: "restricted" });

  it("既定のポリシーは通常の制作物を委員の誰でも見られる（システム管理者も）", () => {
    expect(defaultWorkViewPolicy.normalWorks).toBe("all_members");
    expect(allMembersCanView(normal)).toBe(true);
    expect(allMembersCanView(restricted)).toBe(false);
    expect(canViewWork({ work: normal, grants: [], principal: principal("stranger") })).toBe(true);
    expect(canViewWork({ work: normal, grants: [], principal: principal("sysadmin", true) })).toBe(
      true,
    );
    expect(
      isAllowed("work.view", { work: normal, grants: [], principal: principal("stranger") }),
    ).toBe(true);
  });

  it("ポリシーを involved_only に戻すと、通常の制作物も職責・ACL・関係者・所属の無い人には見えない", () => {
    const ctx = { work: normal, grants: [], viewPolicy: involvedOnly };
    expect(canViewWork({ ...ctx, principal: principal("stranger") })).toBe(false);
    expect(canViewWork({ ...ctx, principal: principal("creator") })).toBe(true);
    expect(canViewWork({ ...ctx, grants: [grant({})], principal: principal("viewer") })).toBe(true);
  });

  it("非公開・取扱注意は、職責か閲覧以上の ACL がある人だけ。無関係な人は見られない（§7.2）", () => {
    expect(canViewWork({ work: restricted, grants: [], principal: principal("stranger") })).toBe(
      false,
    );
    expect(canViewWork({ work: restricted, grants: [], principal: principal("approver") })).toBe(
      true,
    );
    expect(
      canViewWork({ work: restricted, grants: [grant({})], principal: principal("viewer") }),
    ).toBe(true);
    expect(
      canViewWork({
        work: restricted,
        grants: [grant({ revokedAt: 1 })],
        principal: principal("viewer"),
      }),
    ).toBe(false);
  });

  it("非公開でも、関係者と、主管担当・制作担当・関係担当に所属する人は自動で見られる（「自動でつける」）", () => {
    const work = makeWork({
      confidentiality: "restricted",
      stakeholderIds: ["stake"],
      ownerTeamId: "pr",
      productionTeamIds: ["design"],
      relatedTeamIds: ["jim"],
    });
    expect(workTeamIdsOf(work)).toEqual(["pr", "design", "jim"]);
    expect(isInvolvedInWork(work, principal("stake"))).toBe(true);
    expect(canViewWork({ work, grants: [], principal: principal("stake") })).toBe(true);
    for (const team of ["pr", "design", "jim"])
      expect(canViewWork({ work, grants: [], principal: principal("member", false, [team]) })).toBe(
        true,
      );
    // 別の担当の所属・所属の分からない主体は見られない
    expect(canViewWork({ work, grants: [], principal: principal("other", false, ["sys"]) })).toBe(
      false,
    );
    expect(
      canViewWork({
        work,
        grants: [],
        principal: { userId: "x", isSystemAdmin: false, groupIds: [], orgPermissions: [] },
      }),
    ).toBe(false);
  });

  it("関係者・所属は閲覧とコメントまで。校正への参加・編集・割当・校了・ACL の規則は変わらない", () => {
    const work = makeWork({ stakeholderIds: ["stake"], productionTeamIds: ["design"] });
    for (const who of [principal("stake"), principal("member", false, ["design"])]) {
      const ctx = { work, grants: [], principal: who };
      expect(isAllowed("comment.post", ctx)).toBe(true);
      expect(isAllowed("review.participate", ctx)).toBe(false);
      expect(isAllowed("work.edit", ctx)).toBe(false);
      expect(isAllowed("revision.submit", ctx)).toBe(false);
      expect(isAllowed("review.assign", ctx)).toBe(false);
      expect(isAllowed("work.finalize", ctx)).toBe(false);
      expect(isAllowed("acl.manage", ctx)).toBe(false);
    }
    // 委員なら誰でも見られる通常の制作物は、コメントも誰でも書ける。校正への参加には review 以上の ACL か職責が要る
    const stranger = { work, grants: [], principal: principal("stranger") };
    expect(isAllowed("comment.post", stranger)).toBe(true);
    expect(isAllowed("review.participate", stranger)).toBe(false);
  });
});

describe("isAllowed（§7.2 操作権限）", () => {
  const work = makeWork({ confidentiality: "restricted" });
  it("コメントは見られる人なら誰でも、見られない人はできない（非公開）", () => {
    for (const grants of [[grant({})], [grant({ permission: "review" })]]) {
      expect(isAllowed("comment.post", { work, grants, principal: principal("viewer") })).toBe(
        true,
      );
    }
    expect(isAllowed("comment.post", { work, grants: [], principal: principal("stranger") })).toBe(
      false,
    );
    expect(
      isAllowed("review.participate", { work, grants: [], principal: principal("stranger") }),
    ).toBe(false);
  });
  it("校正への参加（review.participate）は review 以上の ACL か職責のみ", () => {
    const ctxOf = (who: string, grants = [grant({})]) => ({
      work,
      grants,
      principal: principal(who),
    });
    expect(isAllowed("review.participate", ctxOf("viewer"))).toBe(false);
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
  // 職責・ACL・関係者・所属のどれも無い非公開の制作物
  const restricted = makeWork({ confidentiality: "restricted" });
  const admin = { ...principal("sysadmin", true), orgPermissions: [] };
  const stranger = { ...principal("stranger"), orgPermissions: [] };

  it("職責・ACL・所属が無い非公開の制作物でも、すべての操作が許される", () => {
    for (const action of actions)
      expect(isAllowed(action, { work: restricted, grants: [], principal: admin }), action).toBe(
        true,
      );
  });

  it("非公開の制作物を見られる。閲覧範囲を関係者だけに戻しても見られる", () => {
    expect(canViewWork({ work: restricted, grants: [], principal: admin })).toBe(true);
    expect(
      canViewWork({
        work: makeWork(),
        grants: [],
        principal: admin,
        viewPolicy: involvedOnly,
      }),
    ).toBe(true);
  });

  it("組織権限は Nogiku Access から何も渡されていなくても、すべて持つ", () => {
    for (const { name } of orgPermissionCatalog)
      expect(hasOrgPermission(admin, name), name).toBe(true);
  });

  it("管理者でない人は変わらない（同じ非公開の制作物で、閲覧も操作も組織権限も持たない）", () => {
    expect(canViewWork({ work: restricted, grants: [], principal: stranger })).toBe(false);
    for (const action of actions)
      expect(isAllowed(action, { work: restricted, grants: [], principal: stranger }), action).toBe(
        false,
      );
    for (const { name } of orgPermissionCatalog)
      expect(hasOrgPermission(stranger, name), name).toBe(false);
  });
});
