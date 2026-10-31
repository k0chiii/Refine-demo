import { DomainError } from "../shared/DomainError.ts";
import { endOfJstDay } from "../shared/deadline.ts";
import { isBeforeDeadline, type Instant } from "../shared/time.ts";

/** 版提出の既定の校正期日: 今日から 3 日後の終わり（JST 23:59 相当） */
export const SUBMIT_DEADLINE_DAYS = 3;
const DAY = 24 * 3_600_000;

export function defaultSubmitDeadlineAt(now: Instant): Instant {
  return endOfJstDay(now + SUBMIT_DEADLINE_DAYS * DAY);
}

/** 緊急提出で選べる最遅の校正期日（既定 3 日後、または受付中の版の期日） */
export function maxUrgentSubmitDeadlineAt(
  now: Instant,
  openAcceptingDeadlineAt?: Instant,
): Instant {
  return openAcceptingDeadlineAt ?? defaultSubmitDeadlineAt(now);
}

export interface SubmitRevisionDeadlineInput {
  now: Instant;
  deadlineAt: Instant | undefined;
  reviewUrgent?: boolean;
  openAcceptingDeadlineAt?: Instant;
}

export function assertSubmitRevisionDeadline(
  input: SubmitRevisionDeadlineInput,
): asserts input is SubmitRevisionDeadlineInput & { deadlineAt: Instant } {
  if (input.deadlineAt === undefined)
    throw new DomainError("revision_deadline_required", {});
  if (!isBeforeDeadline(input.now, input.deadlineAt))
    throw new DomainError("revision_deadline_in_past", {
      now: input.now,
      deadlineAt: input.deadlineAt,
    });
  if (input.reviewUrgent === true) {
    const max = maxUrgentSubmitDeadlineAt(input.now, input.openAcceptingDeadlineAt);
    if (input.deadlineAt > max)
      throw new DomainError("revision_deadline_after_max", {
        deadlineAt: input.deadlineAt,
        maxDeadlineAt: max,
      });
  }
}
