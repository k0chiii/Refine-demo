import type { ReviewAssignment } from "../review/ReviewAssignment.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { RevisionId, UserId } from "../shared/ids.ts";

/**
 * 校正者の名簿の読み方。
 * unset は reviewerIds を一度も書いていない古い行。set の空配列は「校正者なし」と保存済み。
 */
export type ReviewerRoster =
  | { readonly kind: "set"; readonly ids: readonly UserId[] }
  | { readonly kind: "unset" };

/** 名簿から起こす割当の種別。版の提出種別（Revision.reviewType）とは別の定数。 */
export const ROSTER_REVIEW_TYPE = "general" as const;
export type RosterReviewType = typeof ROSTER_REVIEW_TYPE;

export interface WorkReviewerFields {
  reviewerIds?: readonly UserId[] | undefined;
}

export function reviewerRosterOf(work: WorkReviewerFields): ReviewerRoster {
  if (work.reviewerIds === undefined) return { kind: "unset" };
  return { kind: "set", ids: [...work.reviewerIds] };
}

/**
 * 新しい版に載せる名簿。
 * saved は保存済み名簿。derived は未設定から直前の版の割当（excused を除く）を導いたものなので、
 * 呼び出し側は同じトランザクションで Work.reviewerIds に書き戻す。
 */
export type RosterForNewRevision =
  | { readonly kind: "saved"; readonly ids: readonly UserId[] }
  | { readonly kind: "derived"; readonly ids: readonly UserId[] };

export function rosterForNewRevision(
  roster: ReviewerRoster,
  previousAssignments: readonly Pick<ReviewAssignment, "reviewerId" | "state">[],
): RosterForNewRevision {
  if (roster.kind === "set") return { kind: "saved", ids: roster.ids };
  const ids: UserId[] = [];
  for (const a of previousAssignments) {
    if (a.state === "excused") continue;
    if (!ids.includes(a.reviewerId)) ids.push(a.reviewerId);
  }
  return { kind: "derived", ids };
}

export function normalizeReviewerIds(input: readonly string[]): UserId[] {
  const ids: UserId[] = [];
  for (const raw of input) {
    const id = raw.trim();
    if (id === "")
      throw new DomainError("work_invalid", { field: "reviewerIds", reason: "blank_id" });
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface AssignmentSync {
  readonly add: readonly ReviewAssignment[];
  readonly remove: readonly ReviewAssignment[];
}

export function planAssignmentSync(
  rosterIds: readonly UserId[],
  current: readonly ReviewAssignment[],
  revisionId: RevisionId,
): AssignmentSync {
  const wanted: UserId[] = [];
  for (const id of rosterIds) if (!wanted.includes(id)) wanted.push(id);
  const present = new Set(current.map((a) => a.reviewerId));
  const wantedSet = new Set(wanted);
  const add: ReviewAssignment[] = [];
  for (const reviewerId of wanted) {
    if (present.has(reviewerId)) continue;
    add.push({
      revisionId,
      reviewerId,
      reviewType: ROSTER_REVIEW_TYPE,
      state: "pending",
    });
  }
  const remove = current.filter(
    (a) => !wantedSet.has(a.reviewerId) && (a.state === "pending" || a.state === "viewed"),
  );
  return { add, remove };
}

export function isEmptySync(sync: AssignmentSync): boolean {
  return sync.add.length === 0 && sync.remove.length === 0;
}
