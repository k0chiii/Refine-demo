import { describe, expect, it } from "vite-plus/test";
import {
  isUnresponded,
  markResponded,
  markViewed,
  type ReviewAssignment,
} from "../review/ReviewAssignment.ts";
import { HOUR, T0 } from "./fixtures.ts";

const assignment = (over: Partial<ReviewAssignment> = {}): ReviewAssignment => ({
  revisionId: "r1",
  reviewerId: "u1",
  reviewType: "general",
  state: "pending",
  ...over,
});

describe("校正者の確認状態（校正完了 = responded）", () => {
  it("閲覧は viewed までで、responded にはならない", () => {
    const viewed = markViewed(assignment(), T0);
    expect(viewed.state).toBe("viewed");
    expect(markViewed(viewed, T0 + HOUR)).toBe(viewed);
  });

  it("明示的に完了すると responded になり、完了時刻が残る", () => {
    const done = markResponded(markViewed(assignment(), T0), T0 + HOUR);
    expect(done).toMatchObject({ state: "responded", viewedAt: T0, respondedAt: T0 + HOUR });
  });

  it("未閲覧のまま完了しても閲覧時刻を補う", () => {
    expect(markResponded(assignment(), T0)).toMatchObject({ viewedAt: T0, respondedAt: T0 });
  });

  it("完了済みをもう一度完了にしても、最初の完了時刻を変えない", () => {
    const done = markResponded(assignment(), T0);
    expect(markResponded(done, T0 + HOUR)).toBe(done);
  });

  it("免除は完了にならない", () => {
    const excused = assignment({ state: "excused" });
    expect(markResponded(excused, T0)).toBe(excused);
  });

  it("確認を終えていない割当は pending と viewed だけ", () => {
    expect(isUnresponded(assignment())).toBe(true);
    expect(isUnresponded(assignment({ state: "viewed" }))).toBe(true);
    expect(isUnresponded(assignment({ state: "responded" }))).toBe(false);
    expect(isUnresponded(assignment({ state: "excused" }))).toBe(false);
  });
});
