import type { Principal } from "../acl/Permission.ts";

/**
 * 表記統一の権限。
 * - 一般ユーザー: 閲覧・変更提案・誤表記の報告
 * - カテゴリ管理者: 担当カテゴリのルール編集と提案の承認・却下
 * - システム管理者: カテゴリ管理者の設定・全カテゴリの管理
 *
 * Nogiku 連携: 組織権限 `notation:manage`（全カテゴリ）と `notation:category:<code>`（そのカテゴリ）を NAPS に宣言する想定。
 * Nogiku Access 未接続の間はサーバーが組織権限に "*"（制限なし）を入れるが、表記統一の管理権限は "*" では与えない
 * （全員がルールを書き換えられてしまうため）。代わりにシステム管理者が個人単位でカテゴリ管理者を設定する。
 */
export const notationOrgPermissions = {
  manageAll: "notation:manage",
  manageCategory: (code: string) => `notation:category:${code}`,
} as const;

export type NotationRole = "admin" | "manager" | "member";

/** 明示された組織権限だけを見る（"*" は無視） */
function hasExplicit(principal: Principal, name: string): boolean {
  return principal.orgPermissions.includes(name);
}

export function notationRole(
  principal: Principal,
  categoryCode: string,
  managedCategories: readonly string[],
): NotationRole {
  if (principal.isSystemAdmin || hasExplicit(principal, notationOrgPermissions.manageAll))
    return "admin";
  if (
    managedCategories.includes(categoryCode) ||
    hasExplicit(principal, notationOrgPermissions.manageCategory(categoryCode))
  )
    return "manager";
  return "member";
}

export function canEditCategory(
  principal: Principal,
  categoryCode: string,
  managedCategories: readonly string[],
): boolean {
  return notationRole(principal, categoryCode, managedCategories) !== "member";
}

export function canAssignManagers(principal: Principal): boolean {
  return principal.isSystemAdmin || hasExplicit(principal, notationOrgPermissions.manageAll);
}
