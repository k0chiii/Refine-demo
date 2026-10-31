import type { Instant } from "../shared/time.ts";

const DAY_MS = 86_400_000;

/** ◆校了目標日 = ■仕上がり日 − 入稿準備日数（decisions 81 / Issue #92） */
export function approvalTargetFromFinish(finishAt: Instant, submissionPrepDays: number): Instant {
  const days = Number.isFinite(submissionPrepDays)
    ? Math.max(0, Math.trunc(submissionPrepDays))
    : 0;
  return finishAt - days * DAY_MS;
}
