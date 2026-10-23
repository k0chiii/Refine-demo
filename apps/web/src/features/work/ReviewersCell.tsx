import { useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { ReviewersDialog } from "./ReviewersDialog";

export interface ReviewersCellWork {
  id: string;
  title: string;
  reviewers: ReadonlyArray<{ id: string; name: string }>;
  canEditReviewers: boolean;
}

export function reviewersSummary(reviewers: ReviewersCellWork["reviewers"]): string {
  const [first, ...rest] = reviewers;
  if (!first) return "";
  return rest.length > 0 ? `${first.name} ほか${rest.length}人` : first.name;
}

export function ReviewersCell({ w }: { w: ReviewersCellWork }) {
  const [open, setOpen] = useState(false);
  const text = reviewersSummary(w.reviewers);
  const names = w.reviewers.map((r) => r.name).join("、");
  const label = <span className="mf-table__clip works-table__clip">{text || "—"}</span>;
  return (
    <>
      {w.canEditReviewers ? (
        <M3eButton
          variant="text"
          className="works-table__reviewers"
          aria-label={`${w.title} の校正者を選ぶ（いま: ${names || "なし"}）`}
          title={names || undefined}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <M3eIcon slot="icon" name="rate_review" />
          <span className="works-table__approvers-text">{label}</span>
        </M3eButton>
      ) : text ? (
        <span title={names}>{label}</span>
      ) : (
        <span className="muted">—</span>
      )}
      {open ? (
        <span onClick={(e) => e.stopPropagation()}>
          <ReviewersDialog
            workId={w.id}
            title={w.title}
            initialIds={w.reviewers.map((r) => r.id)}
            onClose={() => setOpen(false)}
          />
        </span>
      ) : null}
    </>
  );
}
