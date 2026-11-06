import { describe, expect, it } from "vite-plus/test";
import * as app from "../index.ts";

describe("application の公開面", () => {
  it("版への割当の揃えは公開しない", () => {
    expect("syncRevisionToRoster" in app).toBe(false);
    expect("setWorkReviewers" in app).toBe(true);
    expect("assignReviewers" in app).toBe(false);
  });
});
