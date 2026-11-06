import { DomainError } from "../shared/DomainError.ts";
import type { RevisionId, UserId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";

/**
 * 専門確認（必須チェック）（§2.2-4 / C3 / C6 / D6）。
 * 写真・めい（人名）・外国語・規則・デザインなど、校了前に所管者の確認が必要な事項を版ごとに宣言し、担当者が完了を記録する。
 * 未完了のまま校了する場合は、校了権限者の理由付き例外（監査付き）だけを許す。種別の正式な一覧は D6 で承認待ち。
 */
export const checkTypes = ["photo", "name", "language", "rules", "design", "other"] as const;
export type CheckType = (typeof checkTypes)[number];

export const checkTypeLabels: Record<CheckType, string> = {
  photo: "写真（肖像・権利）",
  name: "めい（人名・団体名）",
  language: "外国語",
  rules: "規則・公式文書",
  design: "デザイン",
  other: "その他",
};

export type CheckState = "pending" | "done" | "waived";

export interface RequiredCheck {
  id: string;
  revisionId: RevisionId;
  type: CheckType;
  label: string;
  assigneeId?: UserId;
  state: CheckState;
  doneBy?: UserId;
  doneAt?: Instant;
  note?: string;
}

export function completeCheck(
  check: RequiredCheck,
  actorId: UserId,
  canActForAnyone: boolean,
  now: Instant,
  note?: string,
): RequiredCheck {
  if (check.state !== "pending")
    throw new DomainError("check_already_done", { checkId: check.id, state: check.state });
  if (!canActForAnyone && check.assigneeId !== undefined && check.assigneeId !== actorId) {
    throw new DomainError("check_not_assignee", { checkId: check.id });
  }
  const next: RequiredCheck = { ...check, state: "done", doneBy: actorId, doneAt: now };
  if (note !== undefined && note.trim() !== "") next.note = note.trim();
  return next;
}

/** 免除は理由必須（主管・校了権限者）。監査に残す。 */
export function waiveCheck(
  check: RequiredCheck,
  actorId: UserId,
  reason: string | undefined,
  now: Instant,
): RequiredCheck {
  if (check.state !== "pending")
    throw new DomainError("check_already_done", { checkId: check.id, state: check.state });
  const r = reason?.trim() ?? "";
  if (r === "") throw new DomainError("check_waive_reason_required", { checkId: check.id });
  return { ...check, state: "waived", doneBy: actorId, doneAt: now, note: r };
}

export function incompleteChecks(checks: readonly RequiredCheck[]): RequiredCheck[] {
  return checks.filter((c) => c.state === "pending");
}
