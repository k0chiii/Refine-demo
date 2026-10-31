import { describe, expect, it } from "vite-plus/test";
import {
  assertSubmitRevisionDeadline,
  defaultSubmitDeadlineAt,
  maxUrgentSubmitDeadlineAt,
} from "../revision/submitDeadline.ts";
import { createRevision, planRevision } from "../revision/Revision.ts";
import { endOfJstDay } from "../shared/deadline.ts";
import { makeRevision } from "./fixtures.ts";

const T0 = Date.UTC(2026, 10, 1, 0, 0);

describe("版提出の校正期日（98A）", () => {
  it("既定は 3 日後の JST 終わり", () => {
    expect(defaultSubmitDeadlineAt(T0)).toBe(endOfJstDay(T0 + 3 * 86_400_000));
  });

  it("緊急の上限は受付中の版の期日があればそれ、無ければ既定", () => {
    const openAt = T0 + 2 * 86_400_000;
    expect(maxUrgentSubmitDeadlineAt(T0, openAt)).toBe(openAt);
    expect(maxUrgentSubmitDeadlineAt(T0)).toBe(defaultSubmitDeadlineAt(T0));
  });

  it("校正期日が無い提出は拒否する", () => {
    expect(() => assertSubmitRevisionDeadline({ now: T0, deadlineAt: undefined })).toThrowError(
      expect.objectContaining({ code: "revision_deadline_required" }),
    );
  });

  it("緊急は上限より遅い校正期日を拒否する", () => {
    const max = defaultSubmitDeadlineAt(T0);
    expect(() =>
      assertSubmitRevisionDeadline({
        now: T0,
        deadlineAt: max + 1,
        reviewUrgent: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "revision_deadline_after_max" }));
    expect(() =>
      assertSubmitRevisionDeadline({
        now: T0,
        deadlineAt: max,
        reviewUrgent: true,
      }),
    ).not.toThrow();
  });

  it("通常提出は上限より遅い校正期日も付けられる", () => {
    const max = defaultSubmitDeadlineAt(T0);
    expect(() =>
      assertSubmitRevisionDeadline({
        now: T0,
        deadlineAt: max + 86_400_000,
        reviewUrgent: false,
      }),
    ).not.toThrow();
  });

  it("createRevision は reviewUrgent を写す", () => {
    const plan = planRevision([], "standard");
    const at = defaultSubmitDeadlineAt(T0);
    const r = createRevision(
      {
        workId: "w1",
        kind: "standard",
        reviewType: "general",
        submittedBy: "u1",
        now: T0,
        deadlineAt: at,
        reviewUrgent: true,
        changeSummary: "",
        focusNotes: "",
      },
      plan,
    );
    expect(r).toMatchObject({ deadlineAt: at, reviewUrgent: true });
  });

  it("緊急は supersede 先の期日を上限にする", () => {
    const open = makeRevision({ deadlineAt: T0 + 2 * 86_400_000 });
    const plan = planRevision([open], "standard");
    expect(() =>
      createRevision(
        {
          workId: open.workId,
          kind: "standard",
          reviewType: "general",
          submittedBy: "u1",
          now: T0,
          deadlineAt: open.deadlineAt + 1,
          reviewUrgent: true,
          changeSummary: "",
          focusNotes: "",
        },
        plan,
      ),
    ).toThrowError(expect.objectContaining({ code: "revision_deadline_after_max" }));
  });
});
