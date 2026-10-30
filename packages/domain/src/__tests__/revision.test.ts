import { describe, expect, it } from "vite-plus/test";
import {
  assertCanPostComment,
  closeByDeadline,
  createRevision,
  latestStandardRevision,
  planRevision,
  revisionLabel,
  supersede,
} from "../revision/Revision.ts";
import { HOUR, T0, makeRevision } from "./fixtures.ts";

describe("planRevision（0版と通常版の分離 / C8, D1, A-18）", () => {
  it("最初の通常版は第1版になる（0版が無くても）", () => {
    expect(planRevision([], "standard").sequence).toBe(1);
  });
  it("0版は sequence 0 で、通常版の番号に影響しない", () => {
    const rough = makeRevision({ id: "r0", kind: "rough", sequence: 0, reviewState: "closed" });
    expect(planRevision([rough], "standard")).toEqual({ sequence: 1, toSupersede: null });
  });
  it("0版は再提出でき、旧ラフは superseded 対象になる（利用者決定）", () => {
    const rough = makeRevision({ id: "r0", kind: "rough", sequence: 0 });
    const plan = planRevision([rough], "rough");
    expect(plan.sequence).toBe(1);
    expect(plan.toSupersede?.id).toBe("r0");
    const closed = { ...rough, reviewState: "closed" as const };
    const second = makeRevision({ id: "r0b", kind: "rough", sequence: 1 });
    expect(planRevision([closed, second], "standard").sequence).toBe(1);
  });
  it("通常版の後に0版は作れない", () => {
    expect(() => planRevision([makeRevision()], "rough")).toThrowError(
      expect.objectContaining({ code: "revision_rough_after_standard" }),
    );
  });
  it("受付中の版があればそれが superseded 対象になる", () => {
    const open = makeRevision({ id: "r1", sequence: 1 });
    const plan = planRevision([open], "standard");
    expect(plan.sequence).toBe(2);
    expect(plan.toSupersede?.id).toBe("r1");
  });
  it("void な版も番号は消費する（版番号は制作物内で一意）。受付対象にはならない", () => {
    const voided = makeRevision({ id: "r2", sequence: 2, reviewState: "void" });
    const plan = planRevision([makeRevision({ reviewState: "closed" }), voided], "standard");
    expect(plan.sequence).toBe(3);
    expect(plan.toSupersede).toBeNull();
  });
});

describe("supersede / closeByDeadline（独立した受付終了 / A-05, A-17）", () => {
  it("新版確定で旧版を superseded として閉じる", () => {
    const old = makeRevision({ id: "r1" });
    const next = makeRevision({ id: "r2", sequence: 2 });
    const closed = supersede(old, next, T0 + HOUR);
    expect(closed.reviewState).toBe("closed");
    expect(closed.reviewClosedReason).toBe("superseded");
    expect(closed.supersededByRevisionId).toBe("r2");
  });
  it("期限で既に閉じた版は superseded に書き換えない", () => {
    const old = closeByDeadline(makeRevision({ id: "r1" }), T0 + 48 * HOUR);
    expect(old.reviewClosedReason).toBe("deadline");
    const after = supersede(old, makeRevision({ id: "r2", sequence: 2 }), T0 + 50 * HOUR);
    expect(after.reviewClosedReason).toBe("deadline");
  });
  it("期限前なら closeByDeadline は何もしない", () => {
    const r = makeRevision();
    expect(closeByDeadline(r, r.deadlineAt! - 1)).toBe(r);
  });
});

describe("assertCanPostComment（期限境界 / A-04）", () => {
  const r = makeRevision();
  const deadline = r.deadlineAt!;
  it("期限の1秒前は投稿できる", () => {
    expect(() => assertCanPostComment(r, deadline - 1000, r.id)).not.toThrow();
  });
  it("期限ちょうどは拒否する", () => {
    expect(() => assertCanPostComment(r, deadline, r.id)).toThrowError(
      expect.objectContaining({ code: "revision_deadline_passed" }),
    );
  });
  it("期限の1秒後は拒否する", () => {
    expect(() => assertCanPostComment(r, deadline + 1000, r.id)).toThrowError(
      expect.objectContaining({ code: "revision_deadline_passed" }),
    );
  });
  it("期限ジョブが遅れて open のままでも時刻比較で拒否する", () => {
    expect(() =>
      assertCanPostComment({ ...r, reviewState: "open" }, deadline + 1, r.id),
    ).toThrow();
  });
  it("superseded 済みの版には投稿できない", () => {
    const closed = supersede(r, makeRevision({ id: "r2", sequence: 2 }), T0 + HOUR);
    expect(() => assertCanPostComment(closed, T0 + 2 * HOUR, "r2")).toThrowError(
      expect.objectContaining({ code: "revision_not_accepting" }),
    );
  });
  it("最新の受付対象版でなければ拒否する", () => {
    expect(() => assertCanPostComment(r, T0 + HOUR, "other")).toThrowError(
      expect.objectContaining({ code: "revision_not_latest" }),
    );
  });
});

describe("createRevision", () => {
  it("過去の期限では版を作れない", () => {
    expect(() =>
      createRevision(
        {
          workId: "w",
          kind: "standard",
          reviewType: "general",
          submittedBy: "c",
          now: T0,
          reviewUrgent: true,
          deadlineAt: T0,
          changeSummary: "",
          focusNotes: "",
        },
        { sequence: 1, toSupersede: null },
      ),
    ).toThrowError(expect.objectContaining({ code: "revision_deadline_in_past" }));
  });
  it("通常提出は校正期限なしで作れる", () => {
    const r = createRevision(
      {
        workId: "w",
        kind: "standard",
        reviewType: "general",
        submittedBy: "c",
        now: T0,
        changeSummary: "",
        focusNotes: "",
      },
      { sequence: 1, toSupersede: null },
    );
    expect(r.deadlineAt).toBeUndefined();
    expect(r.reviewUrgent).toBeUndefined();
  });
});

describe("latestStandardRevision / revisionLabel", () => {
  it("0版は校了候補にならない", () => {
    expect(latestStandardRevision([makeRevision({ kind: "rough", sequence: 0 })])).toBeNull();
  });
  it("ラベルは 0版（ラフ）/ 第n版", () => {
    expect(revisionLabel({ kind: "rough", sequence: 0 })).toBe("0版（ラフ）");
    expect(revisionLabel({ kind: "rough", sequence: 1 })).toBe("0版（ラフ・2回目）");
    expect(revisionLabel({ kind: "standard", sequence: 3 })).toBe("第3版");
  });
});
