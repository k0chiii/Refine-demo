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
import { defaultWorkViewPolicy, type WorkViewPolicy } from "./WorkViewPolicy.ts";

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
  /** 閲覧範囲のポリシー（省略すると {@link defaultWorkViewPolicy}） */
  viewPolicy?: WorkViewPolicy;
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

/** 通常の制作物を委員なら誰でも見られる設定か（一覧・メンション候補の作り方を切り替えるときに使う） */
export function allMembersCanView(
  work: Pick<Work, "confidentiality">,
  policy: WorkViewPolicy = defaultWorkViewPolicy,
): boolean {
  return work.confidentiality === "normal" && policy.normalWorks === "all_members";
}

/**
 * 制作物を見られるか（一覧・検索・メタ情報・通知の本文・FB の制作物へのリンクの可否はこれで決める）。
 * - 職責（制作者・校了権限者・主管）か閲覧以上の ACL がある人
 * - 関係者、主管担当・制作担当・関係担当に所属する人（{@link isInvolvedInWork}。利用者決定 2026-10-17）
 * - 機密区分が通常の制作物は、ポリシーが all_members ならサインインした委員の誰でも（既定。D3 の細則）
 * 非公開・取扱注意（restricted）は上の 2 つだけ。
 * システム管理者は職責・ACL・所属が無くても、非公開も見られる（利用者決定 2026-10-30。旧: 職責・ACL・所属が無ければ見られない）。
 */
export function canViewWork(ctx: AuthorizationContext): boolean {
  if (overridesAllPermissions(ctx.principal)) return true;
  const roles = rolesOf(ctx.work, ctx.principal);
  if (roles.isCreator || roles.isApprover || roles.isManager || hasLevel(ctx, "view")) return true;
  if (isInvolvedInWork(ctx.work, ctx.principal)) return true;
  return allMembersCanView(ctx.work, ctx.viewPolicy);
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
      // 新しいコメントも、制作物を見られる人なら誰でも（利用者決定 2026-10-19「コメントはみんなできて良い」。
      // 2026-10-18 の返信に続き、新規スレッドも review ACL を要らなくする）。校了後の拒否・メンションの規則は別で守る。
      return canViewWork(ctx);
    case "comment.reply":
      // 既存のコメントへの返信は、制作物を見られる人なら誰でも（利用者決定 2026-10-18。D5 の暫定を改める）
      return canViewWork(ctx);
    case "review.participate":
      // 校正に加わる人: 割り当てられた校正者 = review 以上の ACL、制作者・校了者・主管。
      // コメント投稿が広がっても、自動校正・AI 校正・手動のページ対応・担当の確認の完了までは広げない。
      return roles.isCreator || roles.isApprover || roles.isManager || hasLevel(ctx, "review");
    case "comment.decide":
      // 校正者はコメント投稿だけで採否を決めない（§2.1）。制作者と明示委任（edit）のみ。
      return roles.isCreator || hasLevel(ctx, "edit");
    case "review.assign":
      return roles.isManager || roles.isCreator || hasLevel(ctx, "edit");
    case "work.finalize":
    case "work.reopen":
      // 校了は制作物の校了権限者のみ（宣言は校了者ごとに数えるので、ドメインの evaluateFinalization が校了者かを確かめる）
      return roles.isApprover;
    case "approval.confirm":
      // 独立確認（D2）を記録できるのは、制作物の議論に参加できる人（主管・review 以上の ACL など）。
      // 制作者・校了権限者は認可は通るが、独立していないのでドメイン（evaluateIndependentConfirmation）で拒否する。
      return roles.isCreator || roles.isApprover || roles.isManager || hasLevel(ctx, "review");
    case "acl.manage":
      // 閲覧 ACL の作成・変更・取消は校正システム管理者のみ（§5.2-12。管理者は先頭で通っている）。
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
