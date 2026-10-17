import { describe, expect, it } from "vite-plus/test";
import { effectivePermission, type WorkPermissionGrant } from "../acl/Permission.ts";
import {
  allMembersCanView,
  canViewWork,
  isAllowed,
  isInvolvedInWork,
  workTeamIdsOf,
} from "../acl/authorize.ts";
import { defaultWorkViewPolicy, type WorkViewPolicy } from "../acl/WorkViewPolicy.ts";
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
    expect(canViewWork({ ...ctx, principal: principal("sysadmin", true) })).toBe(false);
    expect(canViewWork({ ...ctx, principal: principal("creator") })).toBe(true);
    expect(canViewWork({ ...ctx, grants: [grant({})], principal: principal("viewer") })).toBe(true);
  });

  it("非公開・取扱注意は、職責か閲覧以上の ACL がある人だけ。無関係な人・システム管理者は見られない（§7.2）", () => {
    expect(canViewWork({ work: restricted, grants: [], principal: principal("stranger") })).toBe(
      false,
    );
    expect(
      canViewWork({ work: restricted, grants: [], principal: principal("sysadmin", true) }),
    ).toBe(false);
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

  it("関係者・所属は閲覧だけ。コメント・編集・割当・校了・ACL の規則は変わらない", () => {
    const work = makeWork({ stakeholderIds: ["stake"], productionTeamIds: ["design"] });
    for (const who of [principal("stake"), principal("member", false, ["design"])]) {
      const ctx = { work, grants: [], principal: who };
      expect(isAllowed("comment.post", ctx)).toBe(false);
      expect(isAllowed("work.edit", ctx)).toBe(false);
      expect(isAllowed("revision.submit", ctx)).toBe(false);
      expect(isAllowed("review.assign", ctx)).toBe(false);
      expect(isAllowed("work.finalize", ctx)).toBe(false);
      expect(isAllowed("acl.manage", ctx)).toBe(false);
    }
    // 委員なら誰でも見られる通常の制作物でも、指摘の投稿には review 以上の ACL か職責が要る
    expect(isAllowed("comment.post", { work, grants: [], principal: principal("stranger") })).toBe(
      false,
    );
  });
});

describe("isAllowed（§7.2 操作権限）", () => {
  const work = makeWork({ confidentiality: "restricted" });
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
