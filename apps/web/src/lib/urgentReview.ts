import { formatDeadline, formatDeadlineUntil, remaining } from "./format";

/** 緊急校正の見出し用プレフィックス */
export function urgentReviewPrefix(urgent?: boolean): string {
  return urgent ? "🚨 " : "";
}

/** 制作物一覧など: 校正の締切セル */
export function formatReviewDeadlineCell(
  urgent: boolean | undefined,
  deadlineAt: number | null | undefined,
  now: number,
): string | null {
  if (deadlineAt == null) return urgent ? "🚨 緊急" : null;
  return `${urgentReviewPrefix(urgent)}${formatDeadline(deadlineAt, now)} · ${remaining(deadlineAt, now)}`;
}

/** 版一覧・エディタ: 受付中の表示 */
export function formatOpenReviewDeadline(
  urgent: boolean | undefined,
  deadlineAt: number | undefined,
  now: number,
): string {
  if (deadlineAt === undefined) return urgent ? "🚨 受付中" : "受付中";
  return `${urgentReviewPrefix(urgent)}受付中・締切 ${formatDeadlineUntil(deadlineAt, now)}`;
}
