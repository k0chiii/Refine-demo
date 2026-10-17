import { describe, expect, it } from "vite-plus/test";
import type { ApprovalConfirmation } from "../approval/ApprovalConfirmation.ts";
import {
  defaultApprovalPolicy,
  evaluateFinalization,
  evaluateIndependentConfirmation,
  requiresIndependentConfirmation,
} from "../approval/ApprovalPolicy.ts";
import { HOUR, makeRevision, makeThread, makeWork, T0 } from "./fixtures.ts";

const confirmation = (over: Partial<ApprovalConfirmation> = {}): ApprovalConfirmation => ({
  id: "c1",
  workId: "work1",
  revisionId: "rev1",
  confirmerId: "manager",
  confirmedAt: T0 + HOUR,
  ...over,
});

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
    expect(() => evaluateFinalization({ ...base(), actorId: "manager" })).toThrowError(
      expect.objectContaining({ code: "approval_not_approver" }),
    );
  });
  it("システム管理者であっても approverId でなければ拒否（管理権限≠校了権限）", () => {
    expect(() => evaluateFinalization({ ...base(), actorId: "sysadmin" })).toThrow();
  });
  it("最新でない版は校了できない", () => {
    const revs = [
      makeRevision({ id: "rev1", reviewState: "closed" }),
      makeRevision({ id: "rev2", sequence: 2 }),
    ];
    expect(() =>
      evaluateFinalization({ ...base(), revisions: revs, revisionId: "rev1" }),
    ).toThrowError(expect.objectContaining({ code: "approval_revision_not_candidate" }));
  });
  it("0版からは直接校了できない（制度承認待ち）", () => {
    const revs = [makeRevision({ id: "r0", kind: "rough", sequence: 0 })];
    expect(() =>
      evaluateFinalization({ ...base(), revisions: revs, revisionId: "r0" }),
    ).toThrowError(expect.objectContaining({ code: "approval_rough_revision" }));
  });
  it("重大未解決があると通常校了は拒否", () => {
    const threads = [makeThread({ severity: "critical" })];
    expect(() => evaluateFinalization({ ...base(), threads })).toThrowError(
      expect.objectContaining({ code: "approval_blocking_threads_remain" }),
    );
  });
  it("理由付き例外なら監査付きで校了可", () => {
    const threads = [makeThread({ severity: "critical" })];
    const out = evaluateFinalization({
      ...base(),
      threads,
      exceptionReason: "印刷締切のため、別途修正版を配布",
    });
    expect(out.usedException).toBe(true);
    expect(out.blockingThreadIds).toEqual(["t1"]);
  });
  it("ポリシーで例外禁止なら理由があっても拒否", () => {
    const threads = [makeThread({ severity: "critical" })];
    expect(() =>
      evaluateFinalization({
        ...base(),
        threads,
        exceptionReason: "x",
        policy: {
          blockingSeverities: ["critical"],
          allowSelfApproval: false,
          allowException: false,
          requireChecksComplete: true,
        },
      }),
    ).toThrow();
  });
  it("自己校了（制作者＝校了者）は独立確認なしでは拒否（D2 暫定）", () => {
    const work = makeWork({ creatorIds: ["approver"] });
    expect(() => evaluateFinalization({ ...base(), work })).toThrowError(
      expect.objectContaining({ code: "approval_self_approval_not_allowed" }),
    );
  });
  it("D2: 独立確認は保存された確認の記録だけを数える（申告された ID は受け取らない）", () => {
    const work = makeWork({ creatorIds: ["approver"] });
    // 以前の入口: 存在しない人の ID を申告すれば通っていた（PR #1 レビュー P1）
    expect(() =>
      evaluateFinalization({
        ...base(),
        work,
        ...({ independentConfirmerId: "nonexistent-user" } as object),
      }),
    ).toThrowError(expect.objectContaining({ code: "approval_self_approval_not_allowed" }));
    const out = evaluateFinalization({ ...base(), work, confirmations: [confirmation()] });
    expect(out.requiredChecksSnapshot).toMatchObject({
      selfApproval: true,
      independentConfirmation: { id: "c1", confirmerId: "manager" },
    });
  });
  it("D2: 別の版・別の制作物・本人・制作者・権限を失った人・再開前の確認は無効", () => {
    const work = makeWork({ creatorIds: ["approver"] });
    const reject = (c: ApprovalConfirmation, over: object = {}) =>
      expect(() =>
        evaluateFinalization({ ...base(), work, confirmations: [c], ...over }),
      ).toThrowError(expect.objectContaining({ code: "approval_self_approval_not_allowed" }));
    reject(confirmation({ revisionId: "rev0" }));
    reject(confirmation({ workId: "work2" }));
    reject(confirmation({ confirmerId: "approver" }));
    // 確認の後で制作者に加わった人
    expect(() =>
      evaluateFinalization({
        ...base(),
        work: makeWork({ creatorIds: ["approver", "manager"] }),
        confirmations: [confirmation()],
      }),
    ).toThrow();
    // 制作物に関与していない人（ACL も職責も無い）
    reject(confirmation({ confirmerId: "stranger" }));
    // ACL の review があれば確認者になれる。取り消されたら無効
    const grant = {
      workId: "work1",
      principalType: "user" as const,
      principalId: "reviewer",
      permission: "review" as const,
      grantedBy: "admin",
      grantedAt: T0,
    };
    expect(() =>
      evaluateFinalization({
        ...base(),
        work,
        confirmations: [confirmation({ confirmerId: "reviewer" })],
        grants: [grant],
      }),
    ).not.toThrow();
    reject(confirmation({ confirmerId: "reviewer" }), {
      grants: [{ ...grant, revokedAt: T0 + HOUR, revokedBy: "admin" }],
    });
    // 再開より前の確認
    reject(confirmation(), { confirmationsNotBefore: T0 + 2 * HOUR });
  });
  it("D2: ポリシーで自己校了を許すと独立確認は要らない", () => {
    const work = makeWork({ creatorIds: ["approver"] });
    expect(() =>
      evaluateFinalization({
        ...base(),
        work,
        policy: { ...defaultApprovalPolicy, allowSelfApproval: true },
      }),
    ).not.toThrow();
    expect(requiresIndependentConfirmation(work)).toBe(true);
    expect(
      requiresIndependentConfirmation(work, { ...defaultApprovalPolicy, allowSelfApproval: true }),
    ).toBe(false);
    expect(requiresIndependentConfirmation(makeWork())).toBe(false);
  });
  it("D2: 独立確認を記録できるのは、要る制作物の最新の通常版に、制作者・校了権限者以外が", () => {
    const work = makeWork({ creatorIds: ["approver"] });
    const req = { work, revisions: [makeRevision()], revisionId: "rev1", confirmerId: "manager" };
    expect(evaluateIndependentConfirmation(req).id).toBe("rev1");
    expect(() => evaluateIndependentConfirmation({ ...req, confirmerId: "approver" })).toThrowError(
      expect.objectContaining({ code: "approval_confirmer_not_independent" }),
    );
    expect(() => evaluateIndependentConfirmation({ ...req, work: makeWork() })).toThrowError(
      expect.objectContaining({ code: "approval_confirmation_not_needed" }),
    );
    expect(() =>
      evaluateIndependentConfirmation({
        ...req,
        revisions: [makeRevision(), makeRevision({ id: "rev2", sequence: 2 })],
      }),
    ).toThrowError(expect.objectContaining({ code: "approval_revision_not_candidate" }));
    expect(() =>
      evaluateIndependentConfirmation({
        ...req,
        work: { ...work, lifecycle: "finalized" },
      }),
    ).toThrowError(expect.objectContaining({ code: "work_already_finalized" }));
  });
  it("校了済み作品は再校了できない（A-09）", () => {
    expect(() =>
      evaluateFinalization({ ...base(), work: makeWork({ lifecycle: "finalized" }) }),
    ).toThrowError(expect.objectContaining({ code: "work_already_finalized" }));
  });
});
