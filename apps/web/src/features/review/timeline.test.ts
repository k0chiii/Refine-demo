import { describe, expect, it } from "vite-plus/test";
import { buildTimeline, dayLabel } from "./timeline";

const at = (iso: string) => Date.parse(iso);
const NOW = at("2026-10-16T03:00:00Z"); // 日本時間 10/16 12:00

const post = (id: string, author: string, iso: string, mine = false) => ({
  id,
  author: { id: author },
  createdAt: at(iso),
  mine,
});

describe("FB スレッドの並び", () => {
  it("日付の文言は日本時間で「今日」「昨日」、それ以前は月日と曜日", () => {
    expect(dayLabel(at("2026-10-15T15:30:00Z"), NOW)).toBe("今日"); // 10/16 0:30
    expect(dayLabel(at("2026-10-15T14:30:00Z"), NOW)).toBe("昨日"); // 10/15 23:30
    expect(dayLabel(at("2026-10-13T03:00:00Z"), NOW)).toBe("10月13日（火）");
    expect(dayLabel(at("2025-12-31T03:00:00Z"), NOW)).toBe("2025年12月31日（水）");
  });

  it("同じ人が 5 分以内に続けた投稿はまとめ、日付が変わったら区切る", () => {
    const items = buildTimeline(
      [
        post("a", "u1", "2026-10-15T03:00:00Z", true),
        post("b", "u1", "2026-10-15T03:04:00Z", true),
        post("c", "u1", "2026-10-15T03:20:00Z", true),
        post("d", "u2", "2026-10-16T01:00:00Z"),
      ],
      { readAt: at("2026-10-16T02:00:00Z"), now: NOW },
    );
    expect(
      items.map((i) => (i.type === "post" ? `${i.key}${i.continued ? "+" : ""}` : i.type)),
    ).toEqual(["day", "a", "b+", "c", "day", "d"]);
  });

  it("前に読んだ時刻より後の、ほかの人の最初の投稿の前に「ここから未読」（自分の投稿は数えない）", () => {
    const items = buildTimeline(
      [
        post("a", "u2", "2026-10-16T01:00:00Z"),
        post("b", "u1", "2026-10-16T01:30:00Z", true),
        post("c", "u2", "2026-10-16T02:30:00Z"),
        post("d", "u2", "2026-10-16T02:31:00Z"),
      ],
      { readAt: at("2026-10-16T01:10:00Z"), now: NOW },
    );
    expect(
      items.map((i) => (i.type === "post" ? `${i.key}${i.continued ? "+" : ""}` : i.type)),
    ).toEqual(["day", "a", "b", "unread", "c", "d+"]);
    // 日付が変わる投稿から未読なら、線は日付より先
    const first = buildTimeline([post("a", "u2", "2026-10-16T01:00:00Z")], {
      readAt: null,
      now: NOW,
    });
    expect(first.map((i) => i.type)).toEqual(["unread", "day", "post"]);
    // すべて読んでいれば区切りは無い
    expect(
      buildTimeline([post("a", "u2", "2026-10-16T01:00:00Z")], { readAt: NOW, now: NOW }).some(
        (i) => i.type === "unread",
      ),
    ).toBe(false);
  });
});
