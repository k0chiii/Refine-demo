import { describe, expect, it } from "vite-plus/test";
import { RETRY_AFTER_CAP_MS, retryAfterHintMs, retryAfterMs } from "./retryAfter.ts";

describe("Retry-After", () => {
  const now = Date.UTC(2026, 9, 15, 12);

  it("秒も HTTP の日付も ms にする。無い・読めない・過去は undefined", () => {
    expect(retryAfterHintMs("120", now)).toBe(120_000);
    expect(retryAfterHintMs(new Date(now + 30_000).toUTCString(), now)).toBe(30_000);
    for (const h of [null, "", "0", "-1", "soon", new Date(now - 1000).toUTCString()])
      expect(retryAfterHintMs(h, now), String(h)).toBeUndefined();
  });

  it("待つ時間は上限まで。読めなければ 0", () => {
    expect(retryAfterMs("2", now)).toBe(2000);
    expect(retryAfterMs("120", now)).toBe(RETRY_AFTER_CAP_MS);
    expect(retryAfterMs(null, now)).toBe(0);
    expect(retryAfterMs("soon", now)).toBe(0);
  });
});
