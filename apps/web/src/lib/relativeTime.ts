import { formatJstCompact } from "./format";

/** 経過時間の区分（文言にする前の形。テストはこれを見る） */
export type RelativeTime =
  | { unit: "now" }
  | { unit: "minute"; value: number }
  | { unit: "hour"; value: number }
  | { unit: "date"; at: number };

/** いまから見た時刻の近さ: 1 分未満・1 時間未満（分）・24 時間未満（時間）・それ以上（日付） */
export function relativeTime(at: number, now: number): RelativeTime {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return { unit: "now" };
  if (diff < 3_600_000) return { unit: "minute", value: Math.floor(diff / 60_000) };
  if (diff < 86_400_000) return { unit: "hour", value: Math.floor(diff / 3_600_000) };
  return { unit: "date", at };
}

/** スレッドの一覧の「最後の返信」に出す短い時刻（「たった今」「3 分前」「5 時間前」「10/15」） */
export function formatRelative(at: number, now: number): string {
  const r = relativeTime(at, now);
  switch (r.unit) {
    case "now":
      return "たった今";
    case "minute":
      return `${r.value} 分前`;
    case "hour":
      return `${r.value} 時間前`;
    case "date":
      return formatJstCompact(r.at, now);
  }
}
