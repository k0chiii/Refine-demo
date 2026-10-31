import { M3eAssistChip } from "@m3e/react/chips";
import { M3eIcon } from "@m3e/react/icon";
import { formatDeadline, formatDeadlineUntil, remaining } from "@/lib/format";

/** M3E の assist chip（絵文字は使わない） */
export function UrgentReviewChip({ className }: { className?: string }) {
  return (
    <M3eAssistChip className={className} variant="outlined" aria-label="緊急">
      <M3eIcon slot="icon" name="priority_high" />
      緊急
    </M3eAssistChip>
  );
}

/** 制作物一覧など: 校正期日セル（緊急 chip + 日付） */
export function ReviewDeadlineCell({
  urgent,
  deadlineAt,
  now,
}: {
  urgent?: boolean;
  deadlineAt: number | null | undefined;
  now: number;
}) {
  if (deadlineAt == null) return null;
  return (
    <>
      {urgent ? <UrgentReviewChip className="review-urgent-chip" /> : null}
      {formatDeadline(deadlineAt, now)} · {remaining(deadlineAt, now)}
    </>
  );
}

/** 版一覧・エディタ: 受付中の表示 */
export function formatOpenReviewDeadline(
  urgent: boolean | undefined,
  deadlineAt: number | undefined,
  now: number,
): string {
  if (deadlineAt === undefined) return "受付中";
  return `受付中・校正期日 ${formatDeadlineUntil(deadlineAt, now)}`;
}

export function formatOpenReviewDeadlinePrefix(urgent: boolean | undefined): boolean {
  return urgent === true;
}
