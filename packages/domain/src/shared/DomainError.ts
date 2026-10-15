/**
 * ドメイン層で発生する業務ルール違反。
 * code は UI・API・監査ログで安定して参照できる識別子（日本語メッセージは表示層で解決する）。
 */
export const domainErrorCodes = [
  // 認可
  "forbidden",
  "acl_requires_system_admin",
  "acl_group_principal_not_enabled",
  "acl_cannot_revoke_role_holder",
  // 制作物
  "work_not_active",
  "work_already_finalized",
  "work_not_finalized",
  "work_invalid_lifecycle_transition",
  "work_import_invalid",
  // 版
  "revision_rough_after_standard",
  "revision_sequence_conflict",
  "revision_not_accepting",
  "revision_deadline_passed",
  "revision_not_latest",
  "revision_deadline_in_past",
  "revision_artifacts_not_verified",
  "revision_no_artifacts",
  "revision_void_not_allowed",
  "revision_void_reason_required",
  // 専門確認（必須チェック）
  "check_not_found",
  "check_already_done",
  "check_not_assignee",
  "check_waive_reason_required",
  // 提出準備（アップロードセッション）
  "upload_session_not_open",
  "upload_session_work_mismatch",
  "upload_item_not_found",
  "upload_item_invalid_state",
  "upload_session_expired",
  // 指摘
  "comment_reason_required",
  "comment_invalid_resolution_transition",
  "comment_not_decider",
  "comment_reply_not_allowed",
  "comment_edit_not_author",
  "comment_carry_target_not_accepting",
  "comment_already_carried",
  "comment_carry_same_revision",
  "comment_thread_revision_mismatch",
  "anchor_invalid",
  "anchor_artifact_mismatch",
  "mention_too_many",
  "mention_not_allowed",
  // SNS のアカウント（本体の設定）
  "social_profile_invalid",
  "social_profile_limit",
  "social_profile_in_use",
  // 組織（局 › 担当）
  "team_invalid",
  "team_duplicate",
  "team_in_use",
  "team_not_found",
  // 校了
  "approval_not_approver",
  "approval_revision_not_candidate",
  "approval_rough_revision",
  "approval_blocking_threads_remain",
  "approval_required_checks_incomplete",
  "approval_self_approval_not_allowed",
  "approval_exception_reason_required",
  "approval_exception_not_permitted",
  "approval_reopen_reason_required",
  // 文章の下書き
  "document_invalid",
  // 表記統一
  "notation_rule_invalid",
  "notation_not_manager",
  "notation_category_invalid",
  "notation_proposal_closed",
  // 冪等性 / 競合
  "idempotency_conflict",
  "version_conflict",
] as const;

export type DomainErrorCode = (typeof domainErrorCodes)[number];

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: DomainErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function assertDomain(
  condition: unknown,
  code: DomainErrorCode,
  details?: Record<string, unknown>,
): asserts condition {
  if (!condition) throw new DomainError(code, details);
}
