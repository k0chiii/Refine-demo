import { DomainError } from "../shared/DomainError.ts";
import type { Work } from "../work/Work.ts";
import {
  effectivePermission,
  permissionIncludes,
  type PermissionLevel,
  type Principal,
  type WorkPermissionGrant,
} from "./Permission.ts";

/**
 * 操作権限の最小モデル（§7.2）。
 * 職責（制作者・校了者・主管）と ACL（管理者が付与）を合成して判定する。
 * UI の非表示や署名付き URL は認可の代替にならない。すべてサーバー側でこの関数を通す。
 */
export type WorkAction =
  | "work.view"
  | "work.edit"
  | "revision.submit"
  | "comment.post"
  | "comment.decide"
  | "review.assign"
  | "work.finalize"
  | "work.reopen"
  | "acl.manage"
  | "audit.view";

export interface AuthorizationContext {
  work: Work;
  grants: readonly WorkPermissionGrant[];
  principal: Principal;
}

export interface WorkRoles {
  isCreator: boolean;
  isApprover: boolean;
  isManager: boolean;
}

export function rolesOf(work: Work, principal: Principal): WorkRoles {
  return {
    isCreator: work.creatorIds.includes(principal.userId),
    isApprover: work.approverId === principal.userId,
    isManager: work.managerIds.includes(principal.userId),
  };
}

function hasLevel(ctx: AuthorizationContext, required: PermissionLevel): boolean {
  const level = effectivePermission(ctx.grants, ctx.principal);
  return level !== null && permissionIncludes(level, required);
}

/** 作品に対して何らかの関与（職責または ACL）があるか。一覧・検索・メタ情報の表示可否はこれで決める。 */
export function canViewWork(ctx: AuthorizationContext): boolean {
  const roles = rolesOf(ctx.work, ctx.principal);
  return roles.isCreator || roles.isApprover || roles.isManager || hasLevel(ctx, "view");
}

export function isAllowed(action: WorkAction, ctx: AuthorizationContext): boolean {
  const roles = rolesOf(ctx.work, ctx.principal);
  switch (action) {
    case "work.view":
      return canViewWork(ctx);
    case "work.edit":
      return roles.isManager || hasLevel(ctx, "manage");
    case "revision.submit":
      return roles.isCreator || hasLevel(ctx, "edit");
    case "comment.post":
      // 割り当てられた校正者 = review 以上の ACL。制作者・校了者・主管も議論に参加できる。
      return roles.isCreator || roles.isApprover || roles.isManager || hasLevel(ctx, "review");
    case "comment.decide":
      // 校正者はコメント投稿だけで採否を決めない（§2.1）。制作者と明示委任（edit）のみ。
      return roles.isCreator || hasLevel(ctx, "edit");
    case "review.assign":
      return roles.isManager || roles.isCreator || hasLevel(ctx, "edit");
    case "work.finalize":
    case "work.reopen":
      // 校了は制作物の校了権限者のみ。システム管理者であっても自動的には持たない。
      return roles.isApprover;
    case "acl.manage":
      // 閲覧 ACL の作成・変更・取消は校正システム管理者のみ（§5.2-12）。
      return ctx.principal.isSystemAdmin;
    case "audit.view":
      return ctx.principal.isSystemAdmin || roles.isManager || roles.isApprover;
  }
}

export function requireAllowed(action: WorkAction, ctx: AuthorizationContext): void {
  if (!isAllowed(action, ctx)) {
    throw new DomainError(action === "acl.manage" ? "acl_requires_system_admin" : "forbidden", {
      action,
      workId: ctx.work.id,
    });
  }
}
