import type { Instant } from "../shared/time.ts";

/** 制作物に持つ「第 n 版の予定提出日」（decisions 82。072 の revisions.plannedSubmitAt を置換） */
export interface RevisionPlannedAtEntry {
  sequence: number;
  at: Instant;
}

export interface RevisionPlannedLegacy {
  sequence: number;
  plannedSubmitAt?: Instant;
}

/** 一覧に出す「次の版予定日」（最も早い未来の予定。無ければ null） */
export function nextRevisionPlannedAt(
  entries: readonly RevisionPlannedAtEntry[] | undefined,
  now: Instant,
): Instant | null {
  if (!entries?.length) return null;
  const future = entries.map((e) => e.at).filter((at) => at >= now);
  if (future.length === 0) return null;
  return Math.min(...future);
}
