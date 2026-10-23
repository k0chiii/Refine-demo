import { describe, expect, it } from "vite-plus/test";
import type { ApprovalEvent } from "../approval/ApprovalPolicy.ts";
import {
  focusRevisionIdOf,
  revisionHeadsOf,
  threadTallyOf,
  workSummaryOf,
} from "../dashboard/workSummary.ts";
import { HOUR, makeRevision, makeThread, makeWork, T0 } from "./fixtures.ts";

describe("revisionHeadsOf", () => {
  it("最新は無効を除いて提出の新しい版、受付中は受付中の版。表示名と期限を持つ", () => {
    const rough = makeRevision({
      id: "r0",
      kind: "rough",
      sequence: 0,
      reviewState: "closed",
      reviewClosedReason: "superseded",
      submittedAt: T0,
    });
    const open = makeRevision({ id: "r1", sequence: 1, submittedAt: T0 + HOUR });
    const voided = makeRevision({
      id: "r2",
      sequence: 2,
      reviewState: "void",
      submittedAt: T0 + 2 * HOUR,
    });
    const heads = revisionHeadsOf([rough, open, voided]);
    expect(heads.latest).toEqual({
      id: "r1",
      label: "第1版",
      kind: "standard",
      submittedAt: T0 + HOUR,
      deadlineAt: open.deadlineAt,
      lapsed: false,
    });
    expect(heads.accepting?.id).toBe("r1");
  });

  it("提出時刻が同じなら先に並ぶ版を最新とする（全件を並べ替えていたときと同じ）", () => {
    const a = makeRevision({ id: "a", reviewState: "closed" });
    const b = makeRevision({ id: "b", reviewState: "closed" });
    expect(revisionHeadsOf([a, b]).latest?.id).toBe("a");
  });

  it("版が無ければどちらも null", () => {
    expect(revisionHeadsOf([])).toEqual({ latest: null, accepting: null });
  });
});

describe("focusRevisionIdOf", () => {
  it("受付中の版、無ければ期限で受付が終わった最新の版、どちらでもなければ null", () => {
    const lapsed = makeRevision({
      id: "late",
      reviewState: "closed",
      reviewClosedReason: "deadline",
    });
    const manual = makeRevision({
      id: "done",
      reviewState: "closed",
      reviewClosedReason: "superseded",
    });
    expect(focusRevisionIdOf(revisionHeadsOf([makeRevision({ id: "open" })]))).toBe("open");
    expect(focusRevisionIdOf(revisionHeadsOf([lapsed]))).toBe("late");
    expect(focusRevisionIdOf(revisionHeadsOf([manual]))).toBeNull();
    expect(focusRevisionIdOf(revisionHeadsOf([]))).toBeNull();
  });
});

describe("threadTallyOf", () => {
  it("未解決・全件・最後に立った時刻を数える", () => {
    expect(
      threadTallyOf([
        makeThread({ resolution: "open", createdAt: T0 + 3 * HOUR }),
        makeThread({ resolution: "accepted", createdAt: T0 + HOUR }),
        makeThread({ resolution: "resolved", createdAt: T0 + 5 * HOUR }),
        makeThread({ resolution: "rejected", createdAt: T0 + 2 * HOUR }),
      ]),
    ).toEqual({ unresolved: 2, total: 4, lastCreatedAt: T0 + 5 * HOUR });
    expect(threadTallyOf([])).toEqual({ unresolved: 0, total: 0, lastCreatedAt: null });
  });
});

describe("workSummaryOf", () => {
  const declared = (actorId: string): ApprovalEvent => ({
    workId: "work1",
    revisionId: "rev1",
    actorId,
    action: "declared",
    requiredChecksSnapshot: {},
    createdAt: T0 + HOUR,
  });

  it("校了者が 2 人以上の進行中だけ、数えている版の宣言を数える", () => {
    const work = makeWork({ approverIds: ["approver", "a2"], approvalQuorum: 2 });
    const revisions = [makeRevision()];
    const events = [declared("approver")];
    expect(workSummaryOf({ work, revisions, focusThreads: [], approvalEvents: events })).toEqual({
      ...revisionHeadsOf(revisions),
      threads: { unresolved: 0, total: 0, lastCreatedAt: null },
      declared: 1,
    });
    expect(
      workSummaryOf({ work: makeWork(), revisions, focusThreads: [], approvalEvents: events })
        .declared,
    ).toBe(0);
    expect(
      workSummaryOf({
        work: { ...work, lifecycle: "on_hold" },
        revisions,
        focusThreads: [],
        approvalEvents: events,
      }).declared,
    ).toBe(0);
  });
});
