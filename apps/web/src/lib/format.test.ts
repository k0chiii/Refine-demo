import { describe, expect, it } from "vite-plus/test";
import {
  deadlineFromJst,
  deadlineToJst,
  endOfJstDay,
  formatDeadline,
  formatDeadlineUntil,
  formatJstDate,
  remaining,
} from "./format";

/** JST の壁時計 → epoch ms */
const jst = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);
const NOW = jst(2026, 10, 15, 10);

describe("締切の書式（画面で使う関数は lib/format から。実装は domain）", () => {
  it("日付だけの締切は「11/14（土）23:59 まで」", () => {
    const deadlineAt = deadlineFromJst("2026-11-14")!;
    expect(formatDeadlineUntil(deadlineAt, NOW)).toBe("11/14（土）23:59 まで");
    expect(formatDeadline(deadlineAt, NOW)).toBe("11/14（土）23:59");
  });
  it("時刻を指定した締切は「11/14（土）18:00 まで」", () => {
    expect(formatDeadlineUntil(deadlineFromJst("2026-11-14", "18:00")!, NOW)).toBe(
      "11/14（土）18:00 まで",
    );
  });
  it("入力欄との往復（日付だけ⇔その日の終わり）", () => {
    expect(deadlineToJst(deadlineFromJst("2026-11-14")!)).toEqual({
      date: "2026-11-14",
      time: null,
    });
    expect(deadlineToJst(deadlineFromJst("2026-11-14", "18:00")!)).toEqual({
      date: "2026-11-14",
      time: "18:00",
    });
  });
  it("既定の締切（3 日後の終わり）は日付だけの締切として表示される", () => {
    expect(formatDeadline(endOfJstDay(NOW + 3 * 86_400_000), NOW)).toBe("10/18（日）23:59");
  });
  it("締切ではない日付（最後の動きなど）は年月日だけ", () => {
    expect(formatJstDate(jst(2026, 11, 14, 23, 59))).toBe("2026/11/14");
    expect(formatJstDate(null)).toBe("—");
  });
  it("残り時間は締切の時刻との差（その日の終わりまで数える）", () => {
    const deadlineAt = deadlineFromJst("2026-10-15")!;
    expect(remaining(deadlineAt, NOW)).toBe("残り 14 時間");
    expect(remaining(deadlineAt, jst(2026, 10, 15, 23, 30))).toBe("残り 30 分");
    expect(remaining(deadlineAt, jst(2026, 10, 16))).toBe("期限超過");
  });
});
