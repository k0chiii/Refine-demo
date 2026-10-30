import type { Instant } from "../shared/time.ts";
import type { WorkLifecycle } from "../work/Work.ts";

/** 校正期限が近いとみなす幅（decisions 39A: 24 時間） */
export const DANGER_REVIEW_WINDOW_MS = 24 * 3_600_000;
/** 予定提出（版の plannedSubmitAt）が近いとみなす幅（decisions 39A: 3 日） */
export const DANGER_APPROVAL_TARGET_WINDOW_MS = 3 * 86_400_000;

export interface WorkDangerInput {
  lifecycle: WorkLifecycle;
  /** 受付中の版の校正期限（無ければ null） */
  reviewDeadlineAt: Instant | null;
  /** 版ごとの予定提出日（schema `plannedSubmitAt`。無ければ null） */
  approvalTargetAt: Instant | null;
}

function isFinalized(lifecycle: WorkLifecycle): boolean {
  return lifecycle === "finalized";
}

/**
 * 「危ない」制作物か（decisions 39A）。
 * 校了済みは数えない。校正期限が 24 時間以内（未到来）または既に過ぎている、
 * または予定提出が 3 日以内（未到来）なら true。
 */
export function isWorkDanger(input: WorkDangerInput, now: Instant): boolean {
  if (isFinalized(input.lifecycle)) return false;
  const { reviewDeadlineAt, approvalTargetAt } = input;
  if (reviewDeadlineAt !== null) {
    if (reviewDeadlineAt <= now) return true;
    if (reviewDeadlineAt - now <= DANGER_REVIEW_WINDOW_MS) return true;
  }
  if (
    approvalTargetAt !== null &&
    approvalTargetAt > now &&
    approvalTargetAt - now <= DANGER_APPROVAL_TARGET_WINDOW_MS
  )
    return true;
  return false;
}

/** 危ない制作物の件数 */
export function tallyWorkDanger(inputs: Iterable<WorkDangerInput>, now: Instant): number {
  let n = 0;
  for (const row of inputs) if (isWorkDanger(row, now)) n++;
  return n;
}
