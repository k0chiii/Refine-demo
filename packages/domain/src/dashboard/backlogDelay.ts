import type { Instant } from "../shared/time.ts";

const DAY_MS = 86_400_000;

/** 期限超過からの経過日数に応じた行の色（モック: 1 日=オレンジ・2 日以上=赤） */
export type BacklogDelayTone = "none" | "oneDay" | "twoDaysPlus";

/**
 * @param deadlineAt 校正締切など（過ぎている前提で呼ぶ）
 * @param now 現在時刻
 */
export function backlogDelayTone(deadlineAt: Instant, now: Instant): BacklogDelayTone {
  if (deadlineAt >= now) return "none";
  const lateMs = now - deadlineAt;
  if (lateMs >= 2 * DAY_MS) return "twoDaysPlus";
  if (lateMs >= DAY_MS) return "oneDay";
  return "none";
}

export function backlogDelayClass(tone: BacklogDelayTone): string {
  switch (tone) {
    case "oneDay":
      return "list__item--delay-1d";
    case "twoDaysPlus":
      return "list__item--delay-2d";
    default:
      return "";
  }
}
