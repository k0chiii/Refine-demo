import { describe, expect, it } from "vite-plus/test";
import { canTransition, transitionLifecycle } from "../work/Work.ts";
import { makeWork } from "./fixtures.ts";

describe("制作物の状態の移り変わり（保留は使わない。利用者指示 2026-11-05「保留はいらない」）", () => {
  it("進行中からは保留にできない。中止・校了はできる", () => {
    expect(canTransition("active", "on_hold")).toBe(false);
    expect(canTransition("active", "cancelled")).toBe(true);
    expect(canTransition("active", "finalized")).toBe(true);
    expect(() => transitionLifecycle(makeWork(), "on_hold")).toThrow(
      "work_invalid_lifecycle_transition",
    );
  });
  it("前から保留の制作物は、進行中に戻すか中止できる", () => {
    expect(canTransition("on_hold", "active")).toBe(true);
    expect(canTransition("on_hold", "cancelled")).toBe(true);
  });
});
