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

export interface WorkReviewerFields {
  reviewerIds?: readonly UserId[] | undefined;
}

export function reviewerRosterOf(work: WorkReviewerFields): ReviewerRoster {
  if (work.reviewerIds === undefined) return { kind: "unset" };
  return { kind: "set", ids: [...work.reviewerIds] };
}

/**
 * 新しい版に載せる名簿。保存済みならそれを使う。未設定なら直前の版の校正者（excused を除く）を引き継ぎ、
 * materialize が true のとき呼び出し側が同じトランザクションで Work に書き戻す。
 */
export function rosterForNewRevision(
  roster: ReviewerRoster,
  previousAssignments: readonly Pick<ReviewAssignment, "reviewerId" | "state">[],
): { ids: readonly UserId[]; materialize: boolean } {
  if (roster.kind === "set") return { ids: roster.ids, materialize: false };
  const ids: UserId[] = [];
  for (const a of previousAssignments) {
    if (a.state === "excused") continue;
    if (!ids.includes(a.reviewerId)) ids.push(a.reviewerId);
  }
  return { ids, materialize: true };
}

/** 書き込む名簿。空白は work_invalid。重なりは先に選んだ 1 人。空配列は「校正者なし」。 */
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

/** ある版の割当を名簿へ揃える差。remove はまだ終えていない行（pending / viewed）だけ。 */
export interface AssignmentSync {
  readonly add: readonly ReviewAssignment[];
  readonly remove: readonly ReviewAssignment[];
}

/**
 * 名簿と版の割当の差。responded と excused は消さない。名簿に戻した人は、行が無いので新しい pending になる。
 * 同じ入力にこの結果を適用してもう一度計算すると空になる。
 */
export function planAssignmentSync(
  rosterIds: readonly UserId[],
  current: readonly ReviewAssignment[],
  revisionId: RevisionId,
  reviewType: string,
): AssignmentSync {
  const wanted: UserId[] = [];
  for (const id of rosterIds) if (!wanted.includes(id)) wanted.push(id);
  const present = new Set(current.map((a) => a.reviewerId));
  const wantedSet = new Set(wanted);
  const add: ReviewAssignment[] = [];
  for (const reviewerId of wanted) {
    if (present.has(reviewerId)) continue;
    add.push({ revisionId, reviewerId, reviewType, state: "pending" });
  }
  const remove = current.filter(
    (a) => !wantedSet.has(a.reviewerId) && (a.state === "pending" || a.state === "viewed"),
  );
  return { add, remove };
}

export function isEmptySync(sync: AssignmentSync): boolean {
  return sync.add.length === 0 && sync.remove.length === 0;
}
