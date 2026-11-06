import { DomainError } from "../shared/DomainError.ts";
import { overridesAllPermissions, type Principal } from "./Permission.ts";

/**
 * 組織権限（Nogiku Access 連携の拡張点）。
 * 利用者決定（2026-10-10）: 「制作物を登録できる人」「校正者を割り当てられる人」は Nogiku の権限・役職で管理する。
 * MVP では Nogiku Access 未接続のため、サーバー側が `orgPermissions = ["*"]`（制限なし）を与える。
 * 接続後は Nogiku Access API（POST /permission/check）の結果を入れるだけで、この判定がそのまま効く。
 * 権限名は NAPS（/.well-known/permissions）で Nogiku Access に宣言する想定。階層は ":" 区切り。
 */
export const orgPermissions = {
  worksCreate: "works:create",
  reviewsAssign: "reviews:assign",
  /**
   * 校了者（と校了とみなす人数）を決められる。利用者決定（2026-10-18）「校了者を決めれる権限を作って欲しい」
   * 「登録自体を権限者に限る」: 制作物の登録は works:create に加えて、これも要る（登録は必ず校了者を決めるため）。
   */
  approversAssign: "approvers:assign",
  /**
   * メンションと校正者の割り当てで使うグループを作る・変える・消す。利用者指示（2026-10-29）
   * 「グループメンションを作成できるひとには、そもそも nogiku で権限を管理したい」
   */
  groupsManage: "groups:manage",
} as const;

export type OrgPermissionName = (typeof orgPermissions)[keyof typeof orgPermissions];

export const orgPermissionCatalog: ReadonlyArray<{ name: OrgPermissionName; description: string }> =
  [
    {
      name: orgPermissions.worksCreate,
      description: "制作物を登録・主管担当として管理できる（制作統括・主管担当）",
    },
    {
      name: orgPermissions.reviewsAssign,
      description: "版に校正者を割り当てられる（制作統括・主管担当）",
    },
    {
      name: orgPermissions.approversAssign,
      description: "校了者を決められる（制作物の登録と、校了者・校了とみなす人数の変更）",
    },
    {
      name: orgPermissions.groupsManage,
      description: "メンションと校正者の割り当てで使うグループを作る・変える・消す",
    },
  ];

/** 組織権限を持つか。システム管理者は Nogiku Access の結果によらずすべて持つ（{@link overridesAllPermissions}） */
export function hasOrgPermission(principal: Principal, name: OrgPermissionName): boolean {
  return (
    overridesAllPermissions(principal) ||
    principal.orgPermissions.includes("*") ||
    principal.orgPermissions.includes(name)
  );
}

export function requireOrgPermission(principal: Principal, name: OrgPermissionName): void {
  if (!hasOrgPermission(principal, name))
    throw new DomainError("forbidden", { orgPermission: name });
}

/**
 * 制作物を登録できる。登録は必ず校了者を決めるので、`works:create` と `approvers:assign` の両方が要る。
 * Nogiku Access 未接続（`"*"`）のあいだは全員が持つ。
 */
export function canRegisterWorks(principal: Principal): boolean {
  return (
    hasOrgPermission(principal, orgPermissions.worksCreate) &&
    hasOrgPermission(principal, orgPermissions.approversAssign)
  );
}

export function requireWorkRegistration(principal: Principal): void {
  requireOrgPermission(principal, orgPermissions.worksCreate);
  requireOrgPermission(principal, orgPermissions.approversAssign);
}

/**
 * メンションと校正者の割り当てで使うグループを作る・変える・消せる（システム管理者は {@link hasOrgPermission} で通る）。
 * Nogiku Access 未接続（`"*"`）のあいだは全員が持つ。
 */
export function canManageGroups(principal: Principal): boolean {
  return hasOrgPermission(principal, orgPermissions.groupsManage);
}
