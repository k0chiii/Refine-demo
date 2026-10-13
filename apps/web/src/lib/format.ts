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

/** datetime-local の値（JST として解釈）→ epoch ms。ブラウザのタイムゾーンに依存しない。 */
export function jstLocalToEpoch(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 9, Number(m[5]));
}

/** 日付だけの表示（締切・納期は日付単位。時刻は常に 0:00 JST） */
const fmtDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function formatJstDate(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "—" : fmtDate.format(new Date(ms));
}

/** YYYY-MM-DD（JST の暦日）→ その日の 0:00 JST の epoch ms */
export function jstDateToEpoch(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), -9, 0);
}

/** epoch ms → その JST 暦日の 0:00 JST */
export function startOfJstDay(ms: number): number {
  return jstDateToEpoch(epochToJstLocal(ms)) ?? ms;
}

export function epochToJstLocal(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

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
