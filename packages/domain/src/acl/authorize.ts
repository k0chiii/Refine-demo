import { DomainError } from "../shared/DomainError.ts";
import { hasOrgPermission, orgPermissions } from "./OrgPermission.ts";
import { isApproverOf } from "../work/approvers.ts";
import type { Work } from "../work/Work.ts";
import {
  effectivePermission,
  overridesAllPermissions,
  permissionIncludes,
  type PermissionLevel,
  type Principal,
  type WorkPermissionGrant,
} from "./Permission.ts";

/**
 * 操作権限の最小モデル（§7.2）。
 * 職責（制作者・校了者・主管）と ACL（管理者が付与）を合成して判定する。システム管理者はすべて通る（{@link overridesAllPermissions}）。
 * UI の非表示や署名付き URL は認可の代替にならない。すべてサーバー側でこの関数を通す。
 */
export type WorkAction =
  | "work.view"
  | "work.edit"
  | "revision.submit"
  | "comment.post"
  | "comment.reply"
  | "review.participate"
  | "comment.decide"
  | "review.assign"
  | "work.finalize"
  | "work.reopen"
  | "approval.confirm"
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
    isApprover: isApproverOf(work, principal.userId),
    isManager: work.managerIds.includes(principal.userId),
  };
}

function hasLevel(ctx: AuthorizationContext, required: PermissionLevel): boolean {
  const level = effectivePermission(ctx.grants, ctx.principal);
  return level !== null && permissionIncludes(level, required);
}

/** 制作物に付いている担当（主管担当・制作担当・関係担当）の ID。重なりは除く */
export function workTeamIdsOf(
  work: Pick<Work, "ownerTeamId" | "productionTeamIds" | "relatedTeamIds">,
): string[] {
  return Array.from(
    new Set([
      ...(work.ownerTeamId ? [work.ownerTeamId] : []),
      ...work.productionTeamIds,
      ...work.relatedTeamIds,
    ]),
  );
}

/**
 * 職責ではないが制作物に関わる人か: 関係者（stakeholderIds）、または主管担当・制作担当・関係担当に所属する人。
 * 利用者決定 2026-10-17「（閲覧権限は）自動でつける」。閲覧にだけ効き、ほかの操作の権限にはならない。
 */
export function isInvolvedInWork(
  work: Pick<Work, "stakeholderIds" | "ownerTeamId" | "productionTeamIds" | "relatedTeamIds">,
  principal: Principal,
): boolean {
  if (work.stakeholderIds?.includes(principal.userId)) return true;
  const teamIds = principal.teamIds;
  if (!teamIds || teamIds.length === 0) return false;
  return workTeamIdsOf(work).some((id) => teamIds.includes(id));
}

/** @deprecated 105A: サインインした委員はすべての制作物を見られる。メンション候補の分岐用に常に true */
export function allMembersCanView(_work?: Pick<Work, never>): boolean {
  return true;
}

/**
 * 制作物を見られるか（一覧・検索・メタ情報・通知の本文・FB の制作物へのリンクの可否はこれで決める）。
 * 105A: 機密区分を廃止し、サインインした委員はすべて見られる（未認証は API 層で拒否）。
 */
export function canViewWork(_ctx: AuthorizationContext): boolean {
  return true;
}

export function isAllowed(action: WorkAction, ctx: AuthorizationContext): boolean {
  if (overridesAllPermissions(ctx.principal)) return true;
  const roles = rolesOf(ctx.work, ctx.principal);
  switch (action) {
    case "work.view":
      return canViewWork(ctx);
    case "work.edit":
      return roles.isManager || hasLevel(ctx, "manage");
    case "revision.submit":
      return roles.isCreator || hasLevel(ctx, "edit");
    case "comment.post":
      return canViewWork(ctx);
    case "comment.reply":
      return canViewWork(ctx);
    case "review.participate":
      return roles.isCreator || roles.isApprover || roles.isManager || hasLevel(ctx, "review");
    case "comment.decide":
      return roles.isCreator || hasLevel(ctx, "edit");
    case "review.assign":
      return roles.isManager || roles.isCreator || hasLevel(ctx, "edit");
    case "work.finalize":
    case "work.reopen":
      return roles.isApprover;
    case "approval.confirm":
      return roles.isCreator || roles.isApprover || roles.isManager || hasLevel(ctx, "review");
    case "acl.manage":
      return false;
    case "audit.view":
      return roles.isManager || roles.isApprover;
  }
}

/** 校正者の名簿を決められるか。作品の review.assign（主管・制作者・edit）か、組織権限 reviews:assign。 */
export function mayAssignReviewers(ctx: AuthorizationContext): boolean {
  return (
    isAllowed("review.assign", ctx) || hasOrgPermission(ctx.principal, orgPermissions.reviewsAssign)
  );
}

export function requireAllowed(action: WorkAction, ctx: AuthorizationContext): void {
  if (!isAllowed(action, ctx)) {
    throw new DomainError(action === "acl.manage" ? "acl_requires_system_admin" : "forbidden", {
      action,
      workId: ctx.work.id,
    });
  }
}
