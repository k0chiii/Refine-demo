import { describe, expect, it } from "vite-plus/test";
import {
  DANGER_APPROVAL_TARGET_WINDOW_MS,
  DANGER_REVIEW_WINDOW_MS,
  isWorkDanger,
  tallyWorkDanger,
} from "../dashboard/danger.ts";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 20, 12);

const base = {
  lifecycle: "active" as const,
  reviewDeadlineAt: null as number | null,
  approvalTargetAt: null as number | null,
};

describe("危ない KPI（decisions 39A）", () => {
  it("校了済みは数えない", () => {
    expect(
      isWorkDanger(
        { ...base, lifecycle: "finalized", reviewDeadlineAt: NOW - HOUR },
        NOW,
      ),
    ).toBe(false);
  });

  it("校正期限が 24 時間以内（これから）なら危ない", () => {
    expect(isWorkDanger({ ...base, reviewDeadlineAt: NOW + 20 * HOUR }, NOW)).toBe(true);
    expect(isWorkDanger({ ...base, reviewDeadlineAt: NOW + 25 * HOUR }, NOW)).toBe(false);
  });

  it("校正期限を過ぎていれば危ない", () => {
    expect(isWorkDanger({ ...base, reviewDeadlineAt: NOW - 1 }, NOW)).toBe(true);
  });

  it("予定提出が 3 日以内なら危ない（校了前）", () => {
    expect(
      isWorkDanger({ ...base, approvalTargetAt: NOW + 2 * DAY }, NOW),
    ).toBe(true);
    expect(
      isWorkDanger({ ...base, approvalTargetAt: NOW + 4 * DAY }, NOW),
    ).toBe(false);
    expect(
      isWorkDanger(
        { ...base, lifecycle: "finalized", approvalTargetAt: NOW + DAY },
        NOW,
      ),
    ).toBe(false);
  });

  it("定数と件数", () => {
    expect(DANGER_REVIEW_WINDOW_MS).toBe(24 * HOUR);
    expect(DANGER_APPROVAL_TARGET_WINDOW_MS).toBe(3 * DAY);
    expect(
      tallyWorkDanger(
        [
          { ...base, reviewDeadlineAt: NOW + HOUR },
          { ...base, reviewDeadlineAt: NOW + 48 * HOUR },
        ],
        NOW,
      ),
    ).toBe(1);
  });
});
