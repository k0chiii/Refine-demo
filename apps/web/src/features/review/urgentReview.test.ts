import { describe, expect, it } from "vite-plus/test";
import { formatOpenReviewDeadline } from "@/features/review/UrgentReviewChip";

describe("urgentReview", () => {
  it("緊急プレフィックスに絵文字を使わない", () => {
    const text = formatOpenReviewDeadline(true, Date.UTC(2026, 10, 15), Date.UTC(2026, 10, 1));
    expect(text).not.toMatch(/🚨/);
    expect(text).toContain("校正期日");
  });
});
