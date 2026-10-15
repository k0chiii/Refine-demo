/**
 * 内部時刻は常に UTC epoch ミリ秒。表示（Asia/Tokyo）は表示層の責務。
 * 締切・納期の意味（日付だけ＝その日の終わり）と、その表示「11/14（土）23:59」は deadline.ts。
 */
export type Instant = number;

/** 期限判定は厳密に `now < deadlineAt`（A-04: ちょうどの時刻は不可）。 */
export function isBeforeDeadline(now: Instant, deadlineAt: Instant): boolean {
  return now < deadlineAt;
}

export function isDeadlineReached(now: Instant, deadlineAt: Instant): boolean {
  return now >= deadlineAt;
}
