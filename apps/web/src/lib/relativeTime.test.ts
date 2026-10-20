import { describe, expect, it } from "vite-plus/test";
import { relativeTime } from "./relativeTime";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 20, 3, 0, 0);

describe("経過時間の区分", () => {
  it("1 分未満は now、1 時間未満は分、24 時間未満は時間、それ以上は日付", () => {
    expect(relativeTime(NOW - 30_000, NOW)).toEqual({ unit: "now" });
    expect(relativeTime(NOW - MIN, NOW)).toEqual({ unit: "minute", value: 1 });
    expect(relativeTime(NOW - 59 * MIN, NOW)).toEqual({ unit: "minute", value: 59 });
    expect(relativeTime(NOW - HOUR, NOW)).toEqual({ unit: "hour", value: 1 });
    expect(relativeTime(NOW - 23 * HOUR, NOW)).toEqual({ unit: "hour", value: 23 });
    expect(relativeTime(NOW - 24 * HOUR, NOW)).toEqual({ unit: "date", at: NOW - 24 * HOUR });
  });

  it("未来の時刻（端末の時計のずれ）は now として扱う", () => {
    expect(relativeTime(NOW + 5 * MIN, NOW)).toEqual({ unit: "now" });
  });
});
