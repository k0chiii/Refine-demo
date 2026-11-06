import { describe, expect, it } from "vite-plus/test";
import { mayAssignReviewers } from "../acl/authorize.ts";
import type { Principal, WorkPermissionGrant } from "../acl/Permission.ts";
import type { ReviewAssignment } from "../review/ReviewAssignment.ts";
import { applyWorkPatch, type WorkPatch } from "../work/workInput.ts";
import {
  isEmptySync,
  normalizeReviewerIds,
  planAssignmentSync,
  reviewerRosterOf,
  rosterForNewRevision,
} from "../work/reviewers.ts";
import { makeWork } from "./fixtures.ts";

const revisionId = "rev1";
const reviewType = "general";

const assignment = (over: Partial<ReviewAssignment> = {}): ReviewAssignment => ({
  revisionId,
  reviewerId: "u1",
  reviewType,
  state: "pending",
  ...over,
});

function applied(
  current: readonly ReviewAssignment[],
  roster: readonly string[],
): ReviewAssignment[] {
  const plan = planAssignmentSync(roster, current, revisionId);
  const removed = new Set(plan.remove.map((a) => a.reviewerId));
  return [...current.filter((a) => !removed.has(a.reviewerId)), ...plan.add];
}

describe("校正者の名簿", () => {
  it("未保存と空の名簿は別", () => {
    expect(reviewerRosterOf({})).toEqual({ kind: "unset" });
    expect(reviewerRosterOf({ reviewerIds: [] })).toEqual({ kind: "set", ids: [] });
    expect(reviewerRosterOf({ reviewerIds: ["a"] }).kind).toBe("set");
  });

  it("空白は拒否し、重なりは先の 1 人にまとめ、空はそのまま通す", () => {
    expect(normalizeReviewerIds([" b ", "a", "b"])).toEqual(["b", "a"]);
    expect(normalizeReviewerIds([])).toEqual([]);
    expect(() => normalizeReviewerIds(["a", "  "])).toThrow(
      expect.objectContaining({
        code: "work_invalid",
        details: expect.objectContaining({ field: "reviewerIds", reason: "blank_id" }),
      }),
    );
  });

  it("未設定の名簿は直前の版から excused を除いて作り、保存済みの名簿はそのまま使う", () => {
    const previous = [
      assignment({ reviewerId: "a", state: "responded" }),
      assignment({ reviewerId: "b", state: "excused" }),
      assignment({ reviewerId: "a", state: "pending" }),
      assignment({ reviewerId: "c", state: "viewed" }),
    ];
    expect(rosterForNewRevision({ kind: "unset" }, previous)).toEqual({
      kind: "derived",
      ids: ["a", "c"],
    });
    expect(rosterForNewRevision({ kind: "unset" }, [])).toEqual({ kind: "derived", ids: [] });
    expect(rosterForNewRevision({ kind: "set", ids: [] }, previous)).toEqual({
      kind: "saved",
      ids: [],
    });
  });

  it("外れた未完了だけを消し、完了と excused は残し、戻した人は新しい pending になる", () => {
    const current = [
      assignment({ reviewerId: "keep", state: "responded", respondedAt: 1 }),
      assignment({ reviewerId: "drop-pending", state: "pending" }),
      assignment({ reviewerId: "drop-viewed", state: "viewed", viewedAt: 2 }),
      assignment({ reviewerId: "gone-done", state: "responded", respondedAt: 3 }),
      assignment({ reviewerId: "excused", state: "excused" }),
    ];
    const plan = planAssignmentSync(["keep", "fresh"], current, revisionId);
    expect(plan.add).toEqual([
      { revisionId, reviewerId: "fresh", reviewType: "general", state: "pending" },
    ]);
    expect(plan.remove.map((a) => a.reviewerId)).toEqual(["drop-pending", "drop-viewed"]);
    expect(plan.remove.some((a) => a.state === "excused" || a.state === "responded")).toBe(false);
    const next = applied(current, ["keep", "fresh"]);
    expect(isEmptySync(planAssignmentSync(["keep", "fresh"], next, revisionId))).toBe(true);
    const back = planAssignmentSync(["keep", "fresh", "drop-viewed"], next, revisionId);
    expect(back.add).toEqual([
      { revisionId, reviewerId: "drop-viewed", reviewType: "general", state: "pending" },
    ]);
    expect(back.add[0]).not.toHaveProperty("viewedAt");
  });

  it("同じ名簿をもう一度計画しても差は空", () => {
    const current = [assignment({ reviewerId: "a", state: "viewed", viewedAt: 9 })];
    expect(isEmptySync(planAssignmentSync(["a"], current, revisionId))).toBe(true);
  });

  it("制作物の変更は名簿を書き換えず、版の番号だけ進む", () => {
    const work = makeWork({ reviewerIds: ["a", "b"], version: 4 });
    const next = applyWorkPatch(work, { title: "改題" });
    expect(next.reviewerIds).toEqual(["a", "b"]);
    expect(next.version).toBe(5);
    expect(next.title).toBe("改題");
  });

  it("名簿は校了・中止以外で、割当権限か組織の reviews:assign がある人だけが決められる", () => {
    const work = makeWork();
    const principal = (orgPermissions: string[]): Principal => ({
      userId: "other",
      isSystemAdmin: false,
      groupIds: [],
      orgPermissions,
    });
    const grants: WorkPermissionGrant[] = [];
    expect(mayAssignReviewers({ work, grants, principal: principal([]) })).toBe(false);
    expect(mayAssignReviewers({ work, grants, principal: principal(["reviews:assign"]) })).toBe(
      true,
    );
    expect(
      mayAssignReviewers({
        work,
        grants,
        principal: { ...principal([]), userId: "creator" },
      }),
    ).toBe(true);
  });
});

const rosterStaysOffTheEditPatch: "reviewerIds" extends keyof WorkPatch ? never : true = true;
void rosterStaysOffTheEditPatch;
