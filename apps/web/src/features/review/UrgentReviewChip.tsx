import { M3eAssistChip } from "@m3e/react/chips";
import { M3eIcon } from "@m3e/react/icon";
import { formatDeadline, remaining } from "@/lib/format";

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
      {formatDeadline(deadlineAt, now)}
      <span className="mf-table__sub">{remaining(deadlineAt, now)}</span>
    </>
  );
}
