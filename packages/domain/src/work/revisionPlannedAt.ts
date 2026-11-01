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

/** リストから sequence の予定日。無ければ旧 plannedSubmitAt を読む（移行しない・読取のみ） */
export function revisionPlannedAtOf(
  entries: readonly RevisionPlannedAtEntry[] | undefined,
  revision: RevisionPlannedLegacy,
): Instant | null {
  const hit = entries?.find((e) => e.sequence === revision.sequence);
  if (hit) return hit.at;
  return revision.plannedSubmitAt ?? null;
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

/** 旧 plannedSubmitAt を制作物リストの 1 件に取り込む（移行用） */
export function upsertRevisionPlannedAt(
  entries: readonly RevisionPlannedAtEntry[] | undefined,
  sequence: number,
  at: Instant,
): RevisionPlannedAtEntry[] {
  const rest = (entries ?? []).filter((e) => e.sequence !== sequence);
  return [...rest, { sequence, at }].sort((a, b) => a.sequence - b.sequence);
}
