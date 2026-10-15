import { describe, expect, it } from "vite-plus/test";
import {
  deadlineFromJst,
  deadlineToJst,
  endOfJstDay,
  formatDeadline,
  formatDeadlineUntil,
  isEndOfJstDayDeadline,
  startOfJstDate,
  startOfJstDay,
  toJstDate,
} from "../shared/deadline.ts";
import { isBeforeDeadline } from "../shared/time.ts";
import { assertCanPostComment, closeByDeadline } from "../revision/Revision.ts";
import { makeRevision } from "./fixtures.ts";

/** JST の壁時計 → epoch ms（テスト用） */
const jst = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) =>
  Date.UTC(y, mo - 1, d, h - 9, mi, s, ms);
const NOW = jst(2026, 10, 15, 10, 0);

describe("締切の意味（利用者決定 2026-10-15: 日付だけ＝その日の終わり）", () => {
  it("日付だけの締切は翌日 0:00 JST で持つ", () => {
    expect(deadlineFromJst("2026-11-14")).toBe(jst(2026, 11, 15));
    expect(deadlineFromJst("2026-11-14", null)).toBe(jst(2026, 11, 15));
    expect(deadlineFromJst("2026-11-14", "")).toBe(jst(2026, 11, 15));
  });

  it("14 日締切: 13 日 23:59・14 日 23:59（最後の 1 ms まで）は受付中、15 日 0:00 で終わる", () => {
    const deadlineAt = deadlineFromJst("2026-11-14")!;
    expect(isBeforeDeadline(jst(2026, 11, 13, 23, 59), deadlineAt)).toBe(true);
    expect(isBeforeDeadline(jst(2026, 11, 14, 23, 59), deadlineAt)).toBe(true);
    expect(isBeforeDeadline(jst(2026, 11, 14, 23, 59, 59, 999), deadlineAt)).toBe(true);
    expect(isBeforeDeadline(jst(2026, 11, 15, 0, 0), deadlineAt)).toBe(false);
  });

  it("コメントの受付と期限での受付終了も同じ境界になる", () => {
    const r = makeRevision({ deadlineAt: deadlineFromJst("2026-11-14")! });
    expect(() => assertCanPostComment(r, jst(2026, 11, 14, 23, 59), r.id)).not.toThrow();
    expect(() => assertCanPostComment(r, jst(2026, 11, 15), r.id)).toThrowError(
      expect.objectContaining({ code: "revision_deadline_passed" }),
    );
    expect(closeByDeadline(r, jst(2026, 11, 14, 23, 59)).reviewState).toBe("open");
    expect(closeByDeadline(r, jst(2026, 11, 15)).reviewState).toBe("closed");
  });

  it("時刻を指定したらその時刻で締め切る（ちょうどは受付終了）", () => {
    const deadlineAt = deadlineFromJst("2026-11-14", "18:00")!;
    expect(deadlineAt).toBe(jst(2026, 11, 14, 18));
    expect(isBeforeDeadline(jst(2026, 11, 14, 17, 59), deadlineAt)).toBe(true);
    expect(isBeforeDeadline(jst(2026, 11, 14, 18), deadlineAt)).toBe(false);
  });

  it("形式が違う・存在しない日付・時刻は null", () => {
    expect(deadlineFromJst("2026/11/14")).toBeNull();
    expect(deadlineFromJst("2026-02-30")).toBeNull();
    expect(deadlineFromJst("2026-11-14", "24:00")).toBeNull();
    expect(deadlineFromJst("2026-11-14", "9:00")).toBeNull();
    expect(startOfJstDate("")).toBeNull();
  });

  it("入力欄への逆変換: 翌日 0:00 JST ちょうどは前日・時刻なし、それ以外は日付と時刻", () => {
    expect(deadlineToJst(jst(2026, 11, 15))).toEqual({ date: "2026-11-14", time: null });
    expect(deadlineToJst(jst(2026, 11, 14, 18))).toEqual({ date: "2026-11-14", time: "18:00" });
    expect(deadlineToJst(jst(2026, 11, 14, 0, 30))).toEqual({ date: "2026-11-14", time: "00:30" });
    for (const [date, time] of [
      ["2026-12-31", null],
      ["2026-11-14", "09:05"],
    ] as const)
      expect(deadlineToJst(deadlineFromJst(date, time)!)).toEqual({ date, time });
  });

  it("JST の暦日の境目（UTC の日付と食い違う時間帯）", () => {
    // 11/14 8:59 JST = 11/13 23:59 UTC
    expect(toJstDate(jst(2026, 11, 14, 8, 59))).toBe("2026-11-14");
    expect(startOfJstDay(jst(2026, 11, 14, 8, 59))).toBe(jst(2026, 11, 14));
    expect(endOfJstDay(jst(2026, 11, 14, 23, 59))).toBe(jst(2026, 11, 15));
    expect(endOfJstDay(jst(2026, 11, 15))).toBe(jst(2026, 11, 16));
    expect(isEndOfJstDayDeadline(jst(2026, 11, 15))).toBe(true);
    expect(isEndOfJstDayDeadline(jst(2026, 11, 14, 23, 59))).toBe(false);
  });
});

describe("締切の表示（日付・曜日・時刻）", () => {
  it("日付だけの締切は「その日の 23:59」と見せる", () => {
    expect(formatDeadline(deadlineFromJst("2026-11-14")!, NOW)).toBe("11/14（土）23:59");
    expect(formatDeadlineUntil(deadlineFromJst("2026-11-14")!, NOW)).toBe("11/14（土）23:59 まで");
  });
  it("時刻を指定したらその時刻", () => {
    expect(formatDeadlineUntil(deadlineFromJst("2026-11-14", "18:00")!, NOW)).toBe(
      "11/14（土）18:00 まで",
    );
    expect(formatDeadline(deadlineFromJst("2026-11-02", "09:05")!, NOW)).toBe("11/2（月）09:05");
  });
  it("年が変わるときだけ年を付ける", () => {
    expect(formatDeadline(deadlineFromJst("2026-12-31")!, NOW)).toBe("12/31（木）23:59");
    expect(formatDeadline(deadlineFromJst("2027-01-05")!, NOW)).toBe("2027/1/5（火）23:59");
  });
});
