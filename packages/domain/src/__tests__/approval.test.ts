import { describe, expect, it } from "vite-plus/test";
import { evaluateFinalization } from "../approval/ApprovalPolicy.ts";
import { makeRevision, makeThread, makeWork } from "./fixtures.ts";

const base = () => ({
  work: makeWork(),
  revisionId: "rev1",
  revisions: [makeRevision()],
  threads: [] as ReturnType<typeof makeThread>[],
  actorId: "approver",
});

describe("evaluateFinalization（校了ガード / C3, C6, D2, A-08）", () => {
  it("校了権限者が最終版を校了できる", () => {
    const out = evaluateFinalization(base());
    expect(out.usedException).toBe(false);
    expect(out.revision.id).toBe("rev1");
  });
  it("校了権限者以外は拒否", () => {
    expect(() => evaluateFinalization({ ...base(), actorId: "manager" })).toThrowError(expect.objectContaining({ code: "approval_not_approver" }));
  });
  it("システム管理者であっても approverId でなければ拒否（管理権限≠校了権限）", () => {
    expect(() => evaluateFinalization({ ...base(), actorId: "sysadmin" })).toThrow();
  });
  it("最新でない版は校了できない", () => {
    const revs = [makeRevision({ id: "rev1", reviewState: "closed" }), makeRevision({ id: "rev2", sequence: 2 })];
    expect(() => evaluateFinalization({ ...base(), revisions: revs, revisionId: "rev1" })).toThrowError(expect.objectContaining({ code: "approval_revision_not_candidate" }));
  });
  it("0版からは直接校了できない（制度承認待ち）", () => {
    const revs = [makeRevision({ id: "r0", kind: "rough", sequence: 0 })];
    expect(() => evaluateFinalization({ ...base(), revisions: revs, revisionId: "r0" })).toThrowError(expect.objectContaining({ code: "approval_rough_revision" }));
  });
  it("重大未解決があると通常校了は拒否", () => {
    const threads = [makeThread({ severity: "critical" })];
    expect(() => evaluateFinalization({ ...base(), threads })).toThrowError(expect.objectContaining({ code: "approval_blocking_threads_remain" }));
  });
  it("理由付き例外なら監査付きで校了可", () => {
    const threads = [makeThread({ severity: "critical" })];
    const out = evaluateFinalization({ ...base(), threads, exceptionReason: "印刷締切のため、別途修正版を配布" });
    expect(out.usedException).toBe(true);
    expect(out.blockingThreadIds).toEqual(["t1"]);
  });
  it("ポリシーで例外禁止なら理由があっても拒否", () => {
    const threads = [makeThread({ severity: "critical" })];
    expect(() =>
      evaluateFinalization({ ...base(), threads, exceptionReason: "x", policy: { blockingSeverities: ["critical"], allowSelfApproval: false, allowException: false } }),
    ).toThrow();
  });
  it("自己校了（制作者＝校了者）は独立確認なしでは拒否（D2 暫定）", () => {
    const work = makeWork({ creatorIds: ["approver"] });
    expect(() => evaluateFinalization({ ...base(), work })).toThrowError(expect.objectContaining({ code: "approval_self_approval_not_allowed" }));
    expect(evaluateFinalization({ ...base(), work, independentConfirmerId: "reviewer2" }).requiredChecksSnapshot.selfApproval).toBe(true);
    expect(() => evaluateFinalization({ ...base(), work, independentConfirmerId: "approver" })).toThrow();
  });
  it("校了済み作品は再校了できない（A-09）", () => {
    expect(() => evaluateFinalization({ ...base(), work: makeWork({ lifecycle: "finalized" }) })).toThrowError(expect.objectContaining({ code: "work_already_finalized" }));
  });
});
