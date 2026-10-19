/**
 * FB スレッドの投稿の並び（Slack・Gmail と同じ読みやすさ。UI_M3E §46）:
 * - 日付が変わるところに区切り（「今日」「昨日」「10月14日（火）」。日本時間）
 * - 前に読んだ時刻より後の、ほかの人の最初の投稿の前に「ここから未読」
 * - 同じ人が 5 分以内に続けて書いた投稿はまとめる（2 件目からは名前・アバター・時刻を省く）
 */

const JST = 9 * 3_600_000;
const DAY = 86_400_000;
const weekdays = ["日", "月", "火", "水", "木", "金", "土"] as const;
/** 続けて書いた投稿をまとめる間隔 */
export const GROUP_WINDOW_MS = 5 * 60_000;

const jstDay = (ms: number) => Math.floor((ms + JST) / DAY);

/** 日付の区切りの文言 */
export function dayLabel(ms: number, now: number): string {
  const diff = jstDay(now) - jstDay(ms);
  if (diff === 0) return "今日";
  if (diff === 1) return "昨日";
  const d = new Date(ms + JST);
  const md = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${weekdays[d.getUTCDay()]}）`;
  return new Date(now + JST).getUTCFullYear() === d.getUTCFullYear()
    ? md
    : `${d.getUTCFullYear()}年${md}`;
}

export interface TimelinePost {
  id: string;
  author: { id: string };
  createdAt: number;
  /** 自分の投稿か（未読の区切りでは自分の投稿を数えない） */
  mine: boolean;
}

export type TimelineItem<P> =
  | { type: "day"; key: string; label: string }
  | { type: "unread"; key: "unread" }
  | { type: "post"; key: string; post: P; continued: boolean };

export function buildTimeline<P extends TimelinePost>(
  posts: readonly P[],
  opts: { readAt: number | null; now: number },
): TimelineItem<P>[] {
  const out: TimelineItem<P>[] = [];
  let prev: P | null = null;
  let unreadPlaced = false;
  for (const p of posts) {
    const newDay = prev === null || jstDay(prev.createdAt) !== jstDay(p.createdAt);
    const unread = !unreadPlaced && !p.mine && (opts.readAt === null || p.createdAt > opts.readAt);
    // 未読の線は日付の区切りより先に置く（線まで送ったとき、その日の日付が線の下に見える）
    if (unread) {
      out.push({ type: "unread", key: "unread" });
      unreadPlaced = true;
    }
    if (newDay)
      out.push({
        type: "day",
        key: `day-${jstDay(p.createdAt)}`,
        label: dayLabel(p.createdAt, opts.now),
      });
    const continued =
      !newDay &&
      !unread &&
      prev !== null &&
      prev.author.id === p.author.id &&
      p.createdAt - prev.createdAt <= GROUP_WINDOW_MS;
    out.push({ type: "post", key: p.id, post: p, continued });
    prev = p;
  }
  return out;
}
