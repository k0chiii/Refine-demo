import { describe, expect, it } from "vite-plus/test";
import { nextRevisionPlannedAt } from "../work/revisionPlannedAt.ts";

describe("revisionPlannedAt", () => {
  const now = Date.parse("2026-06-01T00:00:00+09:00");

  it("nextRevisionPlannedAt は未来の最小", () => {
    const past = now - 86_400_000;
    const soon = now + 2 * 86_400_000;
    const later = now + 5 * 86_400_000;
    expect(
      nextRevisionPlannedAt(
        [
          { sequence: 1, at: past },
          { sequence: 2, at: soon },
          { sequence: 3, at: later },
        ],
        now,
      ),
    ).toBe(soon);
  });
});
