import { describe, expect, it } from "vite-plus/test";
import { isAllowed } from "../acl/authorize.ts";
import type { ApprovalConfirmation } from "../approval/ApprovalConfirmation.ts";
import {
  approvalProgressOf,
  declarationsOf,
  evaluateFinalization,
  requiresIndependentConfirmation,
  requiresIndependentConfirmationFor,
  type ApprovalEvent,
} from "../approval/ApprovalPolicy.ts";
import {
  approvalSetupOf,
  approversOf,
  creatorsAmongApprovers,
  isApproverOf,
  normalizeApprovalSetup,
} from "../work/approvers.ts";
import { parseWorkCsv, resolveWorkImport } from "../work/bulkImport.ts";
import { applyWorkPatch, normalizeWorkEssentials } from "../work/workInput.ts";
import { HOUR, makeRevision, makeWork, T0 } from "./fixtures.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const invalid = (field: string, reason: string) =>
  expect.objectContaining({
    code: "work_invalid",
    details: expect.objectContaining({ field, reason }),
  });

/** 複数の校了者を持つ制作物（a1・a2・a3、人数 2） */
const multi = (over = {}) =>
  makeWork({ approverId: "a1", approverIds: ["a1", "a2", "a3"], approvalQuorum: 2, ...over });

const event = (over: Partial<ApprovalEvent> = {}): ApprovalEvent => ({
  workId: "work1",
  revisionId: "rev1",
  actorId: "a1",
  action: "declared",
  requiredChecksSnapshot: {},
  createdAt: T0 + HOUR,
  ...over,
});

const finalize = (work = multi(), actorId = "a1", events: ApprovalEvent[] = []) =>
  evaluateFinalization({
    work,
    revisionId: "rev1",
    revisions: [makeRevision()],
    threads: [],
    actorId,
    events,
  });

describe("校了者と人数の読み方（古い行は移行しない）", () => {
  it("approverIds が無い古い行は [approverId]・人数 1 と読む", () => {
    const old = makeWork();
    expect(approvalSetupOf(old)).toEqual({ approverIds: ["approver"], quorum: 1 });
    expect(approversOf(old)).toEqual(["approver"]);
    expect(isApproverOf(old, "approver")).toBe(true);
    expect(isApproverOf(old, "someone")).toBe(false);
  });

  it("新しい行は approverIds と人数をそのまま読む。範囲外の人数は読める値に寄せる", () => {
    expect(approvalSetupOf(multi())).toEqual({ approverIds: ["a1", "a2", "a3"], quorum: 2 });
    expect(approvalSetupOf(multi({ approvalQuorum: 9 })).quorum).toBe(3);
    expect(approvalSetupOf(multi({ approvalQuorum: 0 })).quorum).toBe(1);
    expect(approvalSetupOf(multi({ approverIds: [] })).approverIds).toEqual(["a1"]);
  });

  it("職責の判定は校了者の全員に効く", () => {
    const work = multi();
    const principal = (userId: string) => ({
      userId,
      isSystemAdmin: false,
      groupIds: [],
      orgPermissions: [],
    });
    for (const id of ["a1", "a2", "a3"])
      expect(isAllowed("work.finalize", { work, grants: [], principal: principal(id) })).toBe(true);
    expect(isAllowed("work.finalize", { work, grants: [], principal: principal("x") })).toBe(false);
  });
});

describe("校了者と人数の検証（書くとき）", () => {
  it("重なりは 1 人にまとめ、人数の省略は 1", () => {
    expect(normalizeApprovalSetup({ approverIds: [" a1 ", "a2", "a1"] })).toEqual({
      approverIds: ["a1", "a2"],
      quorum: 1,
    });
    expect(normalizeApprovalSetup({ approverId: "a1" })).toEqual({
      approverIds: ["a1"],
      quorum: 1,
    });
  });

  it("人数は 1 以上・校了者の数以下の整数", () => {
    const ok = { approverIds: ["a1", "a2", "a3"] };
    expect(normalizeApprovalSetup({ ...ok, approvalQuorum: 3 }).quorum).toBe(3);
    for (const bad of [0, 4, -1, 1.5, Number.NaN])
      expect(() => normalizeApprovalSetup({ ...ok, approvalQuorum: bad })).toThrowError(
        invalid("approvalQuorum", "out_of_range"),
      );
    // 重なりを除いた数が上限
    expect(() =>
      normalizeApprovalSetup({ approverIds: ["a1", "a1"], approvalQuorum: 2 }),
    ).toThrowError(invalid("approvalQuorum", "out_of_range"));
  });

  it("校了者が 0 人・空の ID は拒否", () => {
    expect(() => normalizeApprovalSetup({ approverIds: [] })).toThrowError(
      invalid("approverIds", "required"),
    );
    expect(() => normalizeApprovalSetup({})).toThrowError(invalid("approverIds", "required"));
    expect(() => normalizeApprovalSetup({ approverIds: ["a1", " "] })).toThrowError(
      invalid("approverIds", "blank_id"),
    );
  });

  it("生成・変更で approverId は先頭の 1 人になり、approverIds と人数が揃う", () => {
    const made = normalizeWorkEssentials({
      title: "t",
      category: "c",
      creatorIds: ["c1"],
      managerIds: [],
      approverIds: ["a2", "a1"],
      approvalQuorum: 2,
    });
    expect(made).toMatchObject({ approverId: "a2", approverIds: ["a2", "a1"], approvalQuorum: 2 });
  });

  it("変更: approverId だけの指定は 1 人への置き換え。人数は指定が無ければ校了者の数に収める", () => {
    const work = multi();
    const single = applyWorkPatch(work, { approverId: "z" });
    expect(approvalSetupOf(single)).toEqual({ approverIds: ["z"], quorum: 1 });
    expect(single.approverId).toBe("z");

    const fewer = applyWorkPatch(work, { approverIds: ["a2", "a3"] });
    expect(fewer).toMatchObject({ approverId: "a2", approverIds: ["a2", "a3"], approvalQuorum: 2 });
    const one = applyWorkPatch(work, { approverIds: ["a3"] });
    expect(approvalSetupOf(one)).toEqual({ approverIds: ["a3"], quorum: 1 });

    // 古い行の人数だけを変える
    const legacy = makeWork();
    const added = applyWorkPatch(legacy, { approverIds: ["approver", "b"], approvalQuorum: 2 });
    expect(approvalSetupOf(added)).toEqual({ approverIds: ["approver", "b"], quorum: 2 });
    expect(() => applyWorkPatch(work, { approvalQuorum: 4 })).toThrowError(
      invalid("approvalQuorum", "out_of_range"),
    );
    // 校了者に関係ない変更は校了者を変えない
    expect(approvalSetupOf(applyWorkPatch(work, { title: "新" }))).toEqual(approvalSetupOf(work));
  });
});

describe("制作者は校了者になれない（利用者決定 2026-10-18）", () => {
  const overlap = invalid("approverIds", "creator_is_approver");
  const base = { title: "t", category: "c", managerIds: [] as string[] };

  it("重なりの判定", () => {
    expect(creatorsAmongApprovers(["c1", "c2"], ["a1", "c2"])).toEqual(["c2"]);
    expect(creatorsAmongApprovers(["c1"], ["a1"])).toEqual([]);
  });

  it("登録: 制作者を含む校了者（approverId でも approverIds でも）は拒否", () => {
    expect(() =>
      normalizeWorkEssentials({ ...base, creatorIds: ["c1"], approverId: "c1" }),
    ).toThrowError(overlap);
    expect(() =>
      normalizeWorkEssentials({ ...base, creatorIds: ["c1", "c2"], approverIds: ["a1", " c2 "] }),
    ).toThrowError(overlap);
    expect(
      normalizeWorkEssentials({ ...base, creatorIds: ["c1"], approverIds: ["a1", "a2"] }),
    ).toMatchObject({ approverIds: ["a1", "a2"] });
  });

  it("変更: 校了者に制作者を入れる・制作者に校了者を入れる変更は拒否", () => {
    const work = makeWork();
    expect(() => applyWorkPatch(work, { approverIds: ["approver", "creator"] })).toThrowError(
      overlap,
    );
    expect(() => applyWorkPatch(work, { approverId: "creator" })).toThrowError(overlap);
    expect(() => applyWorkPatch(work, { creatorIds: ["creator", "approver"] })).toThrowError(
      overlap,
    );
    // 同時に外す変更は通る
    expect(
      applyWorkPatch(work, { creatorIds: ["approver"], approverIds: ["creator"] }),
    ).toMatchObject({ creatorIds: ["approver"], approverIds: ["creator"] });
  });

  it("決定前に保存された行（制作者＝校了者）は読めて、無関係な変更は止まらない", () => {
    const legacy = makeWork({ creatorIds: ["same"], approverId: "same" });
    expect(approvalSetupOf(legacy)).toEqual({ approverIds: ["same"], quorum: 1 });
    expect(isApproverOf(legacy, "same")).toBe(true);
    expect(requiresIndependentConfirmation(legacy)).toBe(true);
    expect(requiresIndependentConfirmationFor(legacy, "same")).toBe(true);
    expect(applyWorkPatch(legacy, { title: "新" }).title).toBe("新");
    // 重なりを解消する変更は通る。別の人が新しく重なる変更は弾く
    expect(applyWorkPatch(legacy, { approverIds: ["other"] }).approverId).toBe("other");
    expect(() =>
      applyWorkPatch(legacy, {
        approverIds: ["same", "creator2"],
        creatorIds: ["same", "creator2"],
      }),
    ).toThrowError(overlap);
  });

  it("CSV: 制作者と同じ人を校了者に書いた行は取り込まない（行の問題になる）", () => {
    const directory = [
      { id: "u1", name: "五月 めい", email: "m@example.invalid" },
      { id: "u2", name: "駒場 校了", email: "k@example.invalid" },
    ];
    const resolve = (creators: string, approvers: string) =>
      resolveWorkImport(
        parseWorkCsv(
          ["制作物名,小ジャンル,媒体,制作者,校了者", `A,映像,,${creators},${approvers}`].join("\n"),
          { defaultYear: 100, now: T0 },
        ),
        directory,
      );
    const bad = resolve("五月 めい", "駒場 校了; 五月 めい");
    expect(bad.ready).toBe(0);
    expect(bad.rows[0]!.input).toBeNull();
    expect(bad.rows[0]!.problems.length).toBeGreaterThan(0);
    expect(resolve("五月 めい", "駒場 校了").ready).toBe(1);
  });
});

describe("校了者ごとの宣言と人数（evaluateFinalization）", () => {
  it("1 人目の宣言では人数に届かない。2 人目で届く", () => {
    const first = finalize(multi(), "a1");
    expect(first).toMatchObject({ reached: false, quorum: 2, declaredApproverIds: ["a1"] });
    const second = finalize(multi(), "a2", [event({ actorId: "a1" })]);
    expect(second).toMatchObject({ reached: true, declaredApproverIds: ["a1", "a2"] });
  });

  it("人数が 1（または古い行）なら 1 人の宣言で届く", () => {
    expect(finalize(multi({ approvalQuorum: 1 }), "a3").reached).toBe(true);
    expect(finalize(makeWork(), "approver").reached).toBe(true);
  });

  it("同じ人の宣言は 2 回数えない（届いていないうちの重ねた宣言は拒否）", () => {
    expect(() => finalize(multi(), "a1", [event({ actorId: "a1" })])).toThrowError(
      code("approval_already_declared"),
    );
    // 履歴に同じ人が重なっていても 1 人
    const dup = [event({ actorId: "a1" }), event({ actorId: "a1", createdAt: T0 + 2 * HOUR })];
    expect(declarationsOf(dup, "rev1").map((d) => d.actorId)).toEqual(["a1"]);
    expect(finalize(multi({ approvalQuorum: 3 }), "a2", dup).reached).toBe(false);
  });

  it("校了者でない人・外れた人の宣言は数えない", () => {
    expect(() => finalize(multi(), "outsider")).toThrowError(code("approval_not_approver"));
    const events = [event({ actorId: "removed" }), event({ actorId: "a1" })];
    expect(finalize(multi(), "a2", events)).toMatchObject({
      reached: true,
      declaredApproverIds: ["a1", "a2"],
    });
    expect(
      finalize(multi({ approverIds: ["a2", "a3"] }), "a3", events).declaredApproverIds,
    ).toEqual(["a3"]);
  });

  it("別の版の宣言・再開より前の宣言は数えない", () => {
    expect(finalize(multi(), "a2", [event({ revisionId: "other" })]).reached).toBe(false);
    const reopened = [
      event({ actorId: "a1" }),
      event({ actorId: "a1", action: "reopened", createdAt: T0 + 2 * HOUR }),
    ];
    expect(finalize(multi(), "a2", reopened).reached).toBe(false);
    // 再開のあとに宣言し直せる
    expect(() => finalize(multi(), "a1", reopened)).not.toThrow();
  });

  it("校了の記録（finalized）も 1 人分の宣言として読める", () => {
    const events = [event({ actorId: "a1", action: "finalized" })];
    expect(declarationsOf(events, "rev1").map((d) => d.actorId)).toEqual(["a1"]);
    expect(declarationsOf(events, "rev2")).toEqual([]);
  });

  it("人数を減らして、すでに届いている場合は、残りの校了者の宣言で校了に進める", () => {
    const events = [event({ actorId: "a1" })];
    const out = finalize(multi({ approvalQuorum: 1 }), "a1", events);
    expect(out.reached).toBe(true);
  });

  it("先に宣言した人の例外理由は、届いたときに引き継ぐ", () => {
    const events = [event({ actorId: "a1", exceptionReason: "期限のため" })];
    expect(finalize(multi(), "a2", events).priorExceptionReason).toBe("期限のため");
    expect(
      finalize(multi(), "a2", [event({ actorId: "a1" })]).priorExceptionReason,
    ).toBeUndefined();
  });

  it("進み具合: 進行中は校了候補の版、校了後は校了した版を数える", () => {
    const events = [event({ actorId: "a2" }), event({ actorId: "removed" })];
    const progress = approvalProgressOf(multi(), events, [makeRevision()]);
    expect(progress).toMatchObject({
      quorum: 2,
      declaredIds: ["a2"],
      revisionId: "rev1",
      reached: false,
    });
    const done = approvalProgressOf(
      multi({ lifecycle: "finalized", finalRevisionId: "rev1" }),
      [...events, event({ actorId: "a1", action: "finalized" })],
      [makeRevision()],
    );
    expect(done).toMatchObject({ declaredIds: ["a2", "a1"], reached: true });
  });
});

describe("制作者が校了者に含まれるとき（D2 は校了者ごと）", () => {
  const withCreator = () => multi({ creatorIds: ["a1"] });
  const confirmation = (over: Partial<ApprovalConfirmation> = {}): ApprovalConfirmation => ({
    id: "c1",
    workId: "work1",
    revisionId: "rev1",
    confirmerId: "manager",
    confirmedAt: T0 + HOUR,
    ...over,
  });

  it("制作者である校了者だけが独立確認を要し、ほかの校了者は要らない", () => {
    const work = withCreator();
    expect(requiresIndependentConfirmation(work)).toBe(true);
    expect(requiresIndependentConfirmationFor(work, "a1")).toBe(true);
    expect(requiresIndependentConfirmationFor(work, "a2")).toBe(false);
    expect(requiresIndependentConfirmation(multi())).toBe(false);
    expect(() => finalize(work, "a2")).not.toThrow();
  });

  it("制作者の宣言は独立確認が無ければ受け付けない。確認があれば数える", () => {
    expect(() => finalize(withCreator(), "a1")).toThrowError(
      code("approval_self_approval_not_allowed"),
    );
    const out = evaluateFinalization({
      work: withCreator(),
      revisionId: "rev1",
      revisions: [makeRevision()],
      threads: [],
      actorId: "a1",
      confirmations: [confirmation()],
      grants: [],
    });
    expect(out.declaredApproverIds).toEqual(["a1"]);
  });

  it("校了者は独立した確認者になれない（別の校了者の確認は無効）", () => {
    expect(() =>
      evaluateFinalization({
        work: withCreator(),
        revisionId: "rev1",
        revisions: [makeRevision()],
        threads: [],
        actorId: "a1",
        confirmations: [confirmation({ confirmerId: "a2" })],
        grants: [],
      }),
    ).toThrowError(code("approval_self_approval_not_allowed"));
  });
});

describe("CSV の一括登録（校了者は複数・人数の列）", () => {
  const directory = [
    { id: "u1", name: "五月 めい", email: "mei@example.invalid" },
    { id: "u2", name: "駒場 校了", email: "a@example.invalid" },
    { id: "u3", name: "本郷 校正", email: "b@example.invalid" },
  ];
  const parse = (approvers: string, quorum: string) =>
    resolveWorkImport(
      parseWorkCsv(
        [
          "制作物名,小ジャンル,媒体,制作者,校了者,校了とみなす人数",
          `A,映像,,五月 めい,${approvers},${quorum}`,
        ].join("\n"),
        { defaultYear: 100, now: T0 },
      ),
      directory,
    );

  it("複数の校了者と人数を読んで、登録の内容に渡す", () => {
    const preview = parse('"駒場 校了; 本郷 校正"', "2");
    expect(preview.ready).toBe(1);
    expect(preview.rows[0]!.input).toMatchObject({ approverIds: ["u2", "u3"], approvalQuorum: 2 });
  });

  it("人数の列が空なら送らない（1 として扱う）", () => {
    const row = parse("駒場 校了", "").rows[0]!;
    expect(row.input).toMatchObject({ approverIds: ["u2"] });
    expect(row.input).not.toHaveProperty("approvalQuorum");
  });

  it("人数が校了者の数を超える・0・数でない行は取り込まない", () => {
    for (const q of ["3", "0", "たくさん"])
      expect(parse('"駒場 校了; 本郷 校正"', q).ready).toBe(0);
  });
});
