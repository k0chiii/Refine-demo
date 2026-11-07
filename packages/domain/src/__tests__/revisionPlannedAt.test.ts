import { describe, expect, it } from "vite-plus/test";
import { nextRevisionPlannedAt, revisionPlannedAtOf } from "../work/revisionPlannedAt.ts";

describe("revisionPlannedAt", () => {
  const now = Date.parse("2026-06-01T00:00:00+09:00");

  it("リスト優先で、無ければ旧 plannedSubmitAt", () => {
    const legacy = Date.parse("2026-06-10T00:00:00+09:00");
    const listed = Date.parse("2026-06-12T00:00:00+09:00");
    expect(
      revisionPlannedAtOf([{ sequence: 2, at: listed }], { sequence: 2, plannedSubmitAt: legacy }),
    ).toBe(listed);
    expect(revisionPlannedAtOf(undefined, { sequence: 1, plannedSubmitAt: legacy })).toBe(legacy);
  });

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
