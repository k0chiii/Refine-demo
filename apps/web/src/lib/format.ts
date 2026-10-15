/** 期限は内部 UTC、表示は Asia/Tokyo（§10-5）。日付だけでなく時刻まで必ず表示する。 */
const fmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const fmtShort = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatJst(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "—" : fmt.format(new Date(ms));
}
export function formatJstShort(ms: number): string {
  return fmtShort.format(new Date(ms));
}

/** 日付だけの表示（「最後の動き」など、締切ではない日付。締切・納期は formatDeadline を使う） */
const fmtDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function formatJstDate(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "—" : fmtDate.format(new Date(ms));
}

/**
 * 締切・納期の意味と表示は domain が正本（日付だけ＝その日の終わり。表示は「11/14（土）23:59」）。
 * 通知の文言（application）と画面で同じ書式にするため、実装は 1 か所にしてここから再 export する。
 */
export {
  deadlineFromJst,
  deadlineToJst,
  endOfJstDay,
  formatDeadline,
  formatDeadlineUntil,
  startOfJstDay,
  toJstDate,
} from "@mf100/domain";

export function remaining(deadlineAt: number, now = Date.now()): string {
  const diff = deadlineAt - now;
  if (diff <= 0) return "期限超過";
  const h = Math.floor(diff / 3_600_000);
  if (h >= 48) return `残り ${Math.floor(h / 24)} 日`;
  if (h >= 1) return `残り ${h} 時間`;
  return `残り ${Math.max(1, Math.floor(diff / 60_000))} 分`;
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
