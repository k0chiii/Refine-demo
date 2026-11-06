import type { Instant } from "./time.ts";

/**
 * 締切・納期の意味（利用者決定 2026-10-15。2026-10-13 の「その日の 0:00」を改める）。
 *
 * - 日付だけの締切は **その日の終わり** まで。内部では **翌日 0:00 JST** の時刻で持つ。
 *   受付中の判定は `now < deadlineAt`（{@link isBeforeDeadline}）なので、14 日締切なら 14 日 23:59:59.999 まで受け付け、
 *   15 日 0:00 ちょうどで終わる。23:59:59.999 で持つと `<` の判定で最後の 1 ms を取りこぼすため、翌日 0:00 にしている。
 * - 時刻を指定したら、その時刻で締め切る（その時刻ちょうどは受付終了）。
 * - 表示は「11/14（土）23:59」。翌日 0:00 JST ちょうどの締切は、前日の 23:59 として見せる（「その日の終わり」と読む）。
 *
 * JST は夏時間が無く常に UTC+9 なので、`Intl` を使わず算術で変換する（Convex の実行環境でも同じ結果になる）。
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JST_OFFSET = 9 * HOUR;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 入力欄の値: JST の暦日（YYYY-MM-DD）と、任意の時刻（HH:mm。null は「その日の終わり」） */
export interface JstDeadlineParts {
  date: string;
  time: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** epoch ms → JST の壁時計（UTC のメソッドで読む Date） */
function jstWall(ms: Instant): Date {
  return new Date(ms + JST_OFFSET);
}

/** YYYY-MM-DD（JST の暦日）→ その日の 0:00 JST */
export function startOfJstDate(date: string): Instant | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d) - JST_OFFSET;
  // 2 月 30 日のような繰り上がりは受け付けない
  const back = jstWall(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
    return null;
  return ms;
}

/** YYYY-MM-DD（JST の暦日）→ その日の終わり＝翌日 0:00 JST */
export function endOfJstDate(date: string): Instant | null {
  const start = startOfJstDate(date);
  return start === null ? null : start + DAY;
}

/** epoch ms → その時刻を含む JST 暦日（YYYY-MM-DD） */
export function toJstDate(ms: Instant): string {
  const w = jstWall(ms);
  return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;
}

/** epoch ms → その時刻を含む JST 暦日の 0:00 JST */
export function startOfJstDay(ms: Instant): Instant {
  return ms - ((((ms + JST_OFFSET) % DAY) + DAY) % DAY);
}

/** epoch ms → その時刻を含む JST 暦日の終わり（翌日 0:00 JST）。日付だけの締切の既定値に使う */
export function endOfJstDay(ms: Instant): Instant {
  return startOfJstDay(ms) + DAY;
}

/** 翌日 0:00 JST ちょうど＝「その日の終わり」（日付だけの締切） */
export function isEndOfJstDayDeadline(deadlineAt: Instant): boolean {
  return startOfJstDay(deadlineAt) === deadlineAt;
}

/**
 * 入力欄の値 → 締切の時刻。時刻なしはその日の終わり（翌日 0:00 JST）、時刻ありはその時刻。
 * 形式が正しくなければ null。
 */
export function deadlineFromJst(date: string, time?: string | null): Instant | null {
  if (time === null || time === undefined || time === "") return endOfJstDate(date);
  const start = startOfJstDate(date);
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (start === null || !m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return start + h * HOUR + min * 60_000;
}

/** 締切の時刻 → 入力欄の値。翌日 0:00 JST ちょうどは「前日・時刻なし」と読む（{@link deadlineFromJst} の逆） */
export function deadlineToJst(deadlineAt: Instant): JstDeadlineParts {
  if (isEndOfJstDayDeadline(deadlineAt)) return { date: toJstDate(deadlineAt - 1), time: null };
  const w = jstWall(deadlineAt);
  return { date: toJstDate(deadlineAt), time: `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}` };
}

/**
 * 締切の表示「11/14（土）18:00」。日付だけの締切（翌日 0:00 JST ちょうど）は時刻を書かず「11/14（土）」
 * （利用者指示 2026-10-17「締切の時刻指定がない時『23:59まで』も消して欲しい」。要件 §10-5 の「時刻を必ず見せる」を改めた。DECISIONS）。
 * 年は `now` と違うときだけ前に付ける（「2027/1/5（火）」）。
 */
export function formatDeadline(deadlineAt: Instant, now: Instant = Date.now()): string {
  const endOfDay = isEndOfJstDayDeadline(deadlineAt);
  const w = jstWall(endOfDay ? deadlineAt - 1 : deadlineAt);
  const time = endOfDay ? "" : `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
  const year = w.getUTCFullYear() !== jstWall(now).getUTCFullYear() ? `${w.getUTCFullYear()}/` : "";
  return `${year}${w.getUTCMonth() + 1}/${w.getUTCDate()}（${WEEKDAYS[w.getUTCDay()]}）${time}`;
}

/** 受付の締切の表示。時刻があれば「11/14（土）18:00 まで」、日付だけなら「11/14（土）」 */
export function formatDeadlineUntil(deadlineAt: Instant, now: Instant = Date.now()): string {
  const label = formatDeadline(deadlineAt, now);
  return isEndOfJstDayDeadline(deadlineAt) ? label : `${label} まで`;
}
