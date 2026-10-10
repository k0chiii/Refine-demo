/** 内部時刻は常に UTC epoch ミリ秒。表示（Asia/Tokyo）は表示層の責務。 */
export type Instant = number;

/** 期限判定は厳密に `now < deadlineAt`（A-04: ちょうどの時刻は不可）。 */
export function isBeforeDeadline(now: Instant, deadlineAt: Instant): boolean {
  return now < deadlineAt;
}

export function isDeadlineReached(now: Instant, deadlineAt: Instant): boolean {
  return now >= deadlineAt;
}
