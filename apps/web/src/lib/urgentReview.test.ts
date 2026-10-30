import { describe, expect, it } from "vite-plus/test";
import { formatOpenReviewDeadline, formatReviewDeadlineCell } from "./urgentReview";

const NOW = Date.UTC(2026, 10, 14, 3, 0, 0); // 2026-11-14 12:00 JST

describe("urgentReview display", () => {
  it("通常受付中は締切行なし", () => {
    expect(formatReviewDeadlineCell(false, null, NOW)).toBeNull();
    expect(formatOpenReviewDeadline(false, undefined, NOW)).toBe("受付中");
  });

  it("緊急は 🚨 と期限を出す", () => {
    const deadline = NOW + 6 * 3_600_000;
    expect(formatOpenReviewDeadline(true, deadline, NOW)).toMatch(/^🚨 受付中・締切 /);
    expect(formatReviewDeadlineCell(true, deadline, NOW)).toMatch(/^🚨 /);
  });
});
