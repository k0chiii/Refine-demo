import { DomainError } from "../shared/DomainError.ts";
import type { Principal } from "./Permission.ts";

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
  ];

export function hasOrgPermission(principal: Principal, name: OrgPermissionName): boolean {
  return principal.orgPermissions.includes("*") || principal.orgPermissions.includes(name);
}

export function requireOrgPermission(principal: Principal, name: OrgPermissionName): void {
  if (!hasOrgPermission(principal, name))
    throw new DomainError("forbidden", { orgPermission: name });
}
