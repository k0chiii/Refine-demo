import { describe, expect, it } from "vite-plus/test";
import { evaluateFinalization } from "../approval/ApprovalPolicy.ts";
import { editThreadBody, isCarryCandidate, planCarryForward } from "../comment/CommentThread.ts";
import { completeCheck, waiveCheck, type RequiredCheck } from "../review/RequiredCheck.ts";
import { planRevision, voidRevision } from "../revision/Revision.ts";
import { HOUR, T0, makeRevision, makeThread, makeWork } from "./fixtures.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const check = (over: Partial<RequiredCheck> = {}): RequiredCheck => ({
  id: "c1",
  revisionId: "rev1",
  type: "name",
  label: "めい",
  state: "pending",
  ...over,
});

describe("専門確認（必須チェック）と校了ガード（C3 / D6）", () => {
  it("担当者以外は完了できない。主管など代行可能者は完了できる", () => {
    const c = check({ assigneeId: "expert" });
    expect(() => completeCheck(c, "creator", false, T0)).toThrowError(code("check_not_assignee"));
    expect(completeCheck(c, "expert", false, T0)).toMatchObject({
      state: "done",
      doneBy: "expert",
    });
    expect(completeCheck(c, "manager", true, T0).state).toBe("done");
    expect(() =>
      completeCheck(completeCheck(c, "expert", false, T0), "expert", false, T0),
    ).toThrowError(code("check_already_done"));
  });
  it("免除は理由必須", () => {
    expect(() => waiveCheck(check(), "approver", " ", T0)).toThrowError(
      code("check_waive_reason_required"),
    );
    expect(waiveCheck(check(), "approver", "対象写真なし", T0)).toMatchObject({
      state: "waived",
      note: "対象写真なし",
    });
  });
  it("未完了の専門確認があると通常校了は拒否。理由付き例外なら可。完了すれば通常校了", () => {
    const base = {
      work: makeWork(),
      revisionId: "rev1",
      revisions: [makeRevision()],
      threads: [],
      actorId: "approver",
    };
    expect(() => evaluateFinalization({ ...base, checks: [check()] })).toThrowError(
      code("approval_required_checks_incomplete"),
    );
    const out = evaluateFinalization({
      ...base,
      checks: [check()],
      exceptionReason: "めい確認は印刷後に別途実施",
    });
    expect(out.usedException).toBe(true);
    expect(out.incompleteCheckIds).toEqual(["c1"]);
    expect(
      evaluateFinalization({ ...base, checks: [check({ state: "done" })] }).usedException,
    ).toBe(false);
    // ポリシーで無効化できる（D6 承認までの切替点）
    expect(
      evaluateFinalization({
        ...base,
        checks: [check()],
        policy: {
          blockingSeverities: ["critical"],
          allowSelfApproval: false,
          allowException: true,
          requireChecksComplete: false,
        },
      }).usedException,
    ).toBe(false);
  });
});

describe("指摘の訂正・担当・次版への引き継ぎ（F-07 / §5.2-9）", () => {
  it("訂正は投稿者本人・未判断の間のみ。訂正回数を数える", () => {
    const t = makeThread();
    expect(() => editThreadBody(t, "other", "x")).toThrowError(code("comment_edit_not_author"));
    expect(editThreadBody(t, "reviewer", "修正後").editCount).toBe(1);
    expect(() => editThreadBody({ ...t, resolution: "accepted" }, "reviewer", "x")).toThrowError(
      code("comment_invalid_resolution_transition"),
    );
  });
  it("引き継ぎは原指摘を deferred にし、新版に carriedFrom 付きで複製する（位置は引き継がない）", () => {
    const src = makeThread({
      anchor: { type: "pdf_pin", artifactId: "a", page: 1, point: { x: 0.5, y: 0.5 } },
      assigneeId: "creator",
    });
    const { target, sourceAfter } = planCarryForward(src, "rev2", T0 + HOUR);
    expect(sourceAfter.resolution).toBe("deferred");
    expect(target).toMatchObject({
      revisionId: "rev2",
      carriedFromThreadId: "t1",
      resolution: "open",
      assigneeId: "creator",
    });
    expect(target.anchor).toBeUndefined();
    expect(() => planCarryForward({ ...src, carriedToThreadId: "t9" }, "rev2", T0)).toThrowError(
      code("comment_already_carried"),
    );
    expect(() => planCarryForward(src, "rev1", T0)).toThrowError(
      code("comment_carry_same_revision"),
    );
    expect(isCarryCandidate(makeThread({ resolution: "rejected" }))).toBe(false);
    expect(isCarryCandidate(makeThread({ resolution: "deferred" }))).toBe(true);
  });
});

describe("誤提出の無効化（§5.2-6）", () => {
  it("受付中の版のみ理由付きで無効化でき、版番号は再利用されない", () => {
    const r2 = makeRevision({ id: "r2", sequence: 2 });
    expect(() => voidRevision(r2, "", T0)).toThrowError(code("revision_void_reason_required"));
    expect(() => voidRevision({ ...r2, reviewState: "closed" }, "x", T0)).toThrowError(
      code("revision_void_not_allowed"),
    );
    const voided = voidRevision(r2, "ファイル取り違え", T0 + HOUR);
    expect(voided).toMatchObject({ reviewState: "void", reviewClosedReason: "void" });
    const plan = planRevision(
      [makeRevision({ id: "r1", reviewState: "closed" }), voided],
      "standard",
    );
    expect(plan.sequence).toBe(3);
    expect(plan.toSupersede).toBeNull();
  });
});
