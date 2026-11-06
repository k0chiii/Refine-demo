import type { RevisionId, UserId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";

/** 校正者ごとの確認状態（§5.1）。コメント状態・受付終了・校了と独立。 */
export const assignmentStates = ["pending", "viewed", "responded", "excused"] as const;
export type AssignmentState = (typeof assignmentStates)[number];

export interface ReviewAssignment {
  revisionId: RevisionId;
  reviewerId: UserId;
  reviewType: string;
  state: AssignmentState;
  viewedAt?: Instant;
  respondedAt?: Instant;
}

export function markViewed(a: ReviewAssignment, now: Instant): ReviewAssignment {
  if (a.state !== "pending") return a;
  return { ...a, state: "viewed", viewedAt: now };
}

/**
 * 校正者が自分の確認を明示的に完了したときのみ responded にする（コメント投稿では自動遷移しない: A-06）。
 * 「校正完了」は読了印として残るので、すでに完了していれば時刻も含めて変えない（冪等）。
 */
export function markResponded(a: ReviewAssignment, now: Instant): ReviewAssignment {
  if (a.state === "excused" || a.state === "responded") return a;
  const viewedAt = a.viewedAt ?? now;
  return { ...a, state: "responded", viewedAt, respondedAt: now };
}

/** まだ確認を終えていない割当（期限接近リマインドの対象）: pending か viewed */
export function isUnresponded(a: Pick<ReviewAssignment, "state">): boolean {
  return a.state === "pending" || a.state === "viewed";
}
