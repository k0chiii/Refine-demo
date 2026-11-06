import { describe, expect, it } from "vite-plus/test";
import { decideThread, isBlockingForApproval } from "../comment/CommentThread.ts";
import { makeThread } from "./fixtures.ts";

describe("decideThread（採否と理由 / C4, A-07）", () => {
  it("不採用には理由が必須", () => {
    expect(() => decideThread(makeThread(), "rejected", "")).toThrowError(
      expect.objectContaining({ code: "comment_reason_required" }),
    );
    expect(decideThread(makeThread(), "rejected", "仕様通り").resolution).toBe("rejected");
  });
  it("保留（次版へ持越）にも理由が必須", () => {
    expect(() => decideThread(makeThread(), "deferred", undefined)).toThrow();
  });
  it("採用は理由なしで可", () => {
    expect(decideThread(makeThread(), "accepted", undefined).resolution).toBe("accepted");
  });
  it("不正な遷移は拒否", () => {
    const resolved = makeThread({ resolution: "resolved" });
    expect(() => decideThread(resolved, "rejected", "x")).toThrowError(
      expect.objectContaining({ code: "comment_invalid_resolution_transition" }),
    );
  });
});

describe("isBlockingForApproval（重大未解決 / C6）", () => {
  it("open な major は校了をブロックする", () => {
    expect(isBlockingForApproval(makeThread({ severity: "major" }), ["critical", "major"])).toBe(
      true,
    );
  });
  it("rejected / deferred / resolved はブロックしない", () => {
    for (const resolution of ["rejected", "deferred", "resolved"] as const) {
      expect(isBlockingForApproval(makeThread({ resolution }), ["critical", "major"])).toBe(false);
    }
  });
  it("accepted（反映すると判断したが未反映）はブロックする", () => {
    expect(
      isBlockingForApproval(makeThread({ resolution: "accepted" }), ["critical", "major"]),
    ).toBe(true);
  });
  it("discussion はブロックしない、minor は閾値外", () => {
    expect(
      isBlockingForApproval(makeThread({ kind: "discussion", severity: "critical" }), ["critical"]),
    ).toBe(false);
    expect(isBlockingForApproval(makeThread({ severity: "minor" }), ["critical", "major"])).toBe(
      false,
    );
  });
});
