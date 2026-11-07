import {
  approversOf,
  countsDeclarations,
  focusRevisionIdOf,
  revisionHeadsOf,
  revisionThreadStatsOf,
  workSummaryOf,
  type ApprovalEvent,
  type CommentThread,
  type Revision,
  type Work,
  type WorkSummary,
} from "@mf100/domain";
import { keyOf, Rows } from "./docs.ts";
import type { Sql } from "./sql.ts";
import { substringTokens, workSearchText } from "./workSearch.ts";

/**
 * 派生表の書き込み。Convex の lib/adapters.ts（syncWorkRoles / syncWorkSummary / syncRevisionThreadStats /
 * adjustUnreadCounter）と同じ契約: 元の行を書いた同じトランザクションで作り直す。読む側は表だけを読む。
 * 変わらないときは書かない（購読者の読み直しを無駄に起こさないため。run.ts の touched は書いた表の名前で決まる）。
 * 数え直しは元の行から導くので、何度呼んでも同じ（冪等）。
 *
 * ponytail: workAggregateEntries は持たない。Convex は集計コンポーネントで年度×状態を数えるが、ここは works を GROUP BY で数える。
 */

/** この版より古い行は信用せず、読む側が版から数え直す（Convex の WORK_SUMMARY_VERSION と同じ） */
export const WORK_SUMMARY_VERSION = 2;

// ------------------------------------------------------------------ workSummaries

/** 表の行（id = workId）。doc の形は Convex の workSummaries と同じ */
interface SummaryRow extends Partial<WorkSummary> {
  workId: string;
  latestId: string | null;
  acceptingId: string | null;
  summaryVersion?: number;
}

/** 揃っていない行（古い版・欠け）は null: 読む側が元から数え直す */
export function readWorkSummary(sql: Sql, workId: string): WorkSummary | null {
  const row = new Rows<SummaryRow>(sql, "workSummaries").select("WHERE id = ?", workId)[0];
  return row ? summaryFromRow(row) : null;
}

export function summaryFromRow(row: SummaryRow): WorkSummary | null {
  const { summaryVersion, latest, accepting, threads, declared } = row;
  if (
    summaryVersion === undefined ||
    summaryVersion < WORK_SUMMARY_VERSION ||
    latest === undefined ||
    accepting === undefined ||
    threads === undefined ||
    declared === undefined
  )
    return null;
  return { latest, accepting, threads, declared };
}

/** 呼び出し側がこのトランザクションで読み終えた、ある版の削除されていないスレッド */
interface KnownRevisionThreads {
  revisionId: string;
  liveThreads: readonly Pick<CommentThread, "resolution" | "createdAt">[];
}

/** 元の行（works・revisions・threads・approvals）から要約を作る。表を作り直すときと、行が無いときの読みが同じ計算を使う */
export function computeWorkSummary(
  sql: Sql,
  work: Work,
  known?: KnownRevisionThreads,
): WorkSummary {
  const revisions = new Rows<Revision>(sql, "revisions").select(
    "WHERE workId = ? ORDER BY rowid",
    work.id,
  );
  const focusId = focusRevisionIdOf(revisionHeadsOf(revisions));
  const focusThreads = !focusId
    ? []
    : known && known.revisionId === focusId
      ? known.liveThreads
      : new Rows<CommentThread>(sql, "threads").select(
          "WHERE revisionId = ? AND deletedAt IS NULL ORDER BY rowid",
          focusId,
        );
  const approvalEvents = countsDeclarations(work)
    ? new Rows<ApprovalEvent>(sql, "approvals").select("WHERE workId = ? ORDER BY rowid", work.id)
    : [];
  return workSummaryOf({ work, revisions, focusThreads, approvalEvents });
}

export function syncWorkSummary(sql: Sql, workId: string, known?: KnownRevisionThreads): void {
  const work = new Rows<Work>(sql, "works").select("WHERE id = ?", workId)[0];
  if (!work) return;
  const summary = computeWorkSummary(sql, work, known);
  const value = {
    workId,
    latestId: summary.latest?.id ?? null,
    acceptingId: summary.accepting?.id ?? null,
    summaryVersion: WORK_SUMMARY_VERSION,
    ...summary,
  };
  const [stored] = sql.exec("SELECT doc FROM workSummaries WHERE id = ?", workId);
  // 同じ関数が同じ順で書くので、文字列が同じなら値も同じ
  if (stored?.doc === JSON.stringify(value)) return;
  new Rows<typeof value>(sql, "workSummaries").upsert(workId, value);
}

// ------------------------------------------------------------------ workRoles / workSearch

/**
 * 制作物の職責・検索・要約を今の制作物に合わせる（works の insert / update のあと）。
 * Convex の syncWorkRoles と同じ並び: 職責 → 検索 → 要約
 */
export function syncWorkRoles(sql: Sql, work: Work): void {
  const roles = new Rows<{ workId: string; userId: string; role: string }>(sql, "workRoles");
  // 同じ人が同じ職責に重ねて入らないよう、鍵で一意にする
  const wanted = new Map<string, { workId: string; userId: string; role: string }>();
  for (const [role, ids] of [
    ["creator", work.creatorIds],
    ["manager", work.managerIds],
    // 校了者は全員（複数の校了者。古い行は approverId の 1 人）
    ["approver", approversOf(work)],
  ] as const)
    for (const userId of ids)
      wanted.set(keyOf(work.id, role, userId), { workId: work.id, userId, role });
  const existing = sql
    .exec("SELECT id FROM workRoles WHERE workId = ?", work.id)
    .map((r) => r.id as string);
  for (const id of existing) if (!wanted.has(id)) roles.delete(id);
  const have = new Set(existing);
  for (const [id, row] of wanted) if (!have.has(id)) roles.upsert(id, row);
  syncWorkSearch(sql, work);
  syncWorkSummary(sql, work.id);
}

/** 検索の行（FTS5）を今の題名・目的・分類・タグ・旧 ID・年度・状態に合わせる。rowid は works の rowid（変わらなければ書かない） */
export function syncWorkSearch(sql: Sql, work: Work): void {
  const [w] = sql.exec("SELECT rowid AS rid FROM works WHERE id = ?", work.id);
  if (!w) return;
  const rid = w.rid as number;
  const tokens = substringTokens(workSearchText(work));
  const [stored] = sql.exec("SELECT tokens, year, lifecycle FROM workSearch WHERE rowid = ?", rid);
  if (
    stored &&
    stored.tokens === tokens &&
    stored.year === work.year &&
    stored.lifecycle === work.lifecycle
  )
    return;
  if (stored) sql.exec("DELETE FROM workSearch WHERE rowid = ?", rid);
  sql.exec(
    "INSERT INTO workSearch (rowid, tokens, workId, year, lifecycle) VALUES (?, ?, ?, ?, ?)",
    rid,
    tokens,
    work.id,
    work.year,
    work.lifecycle,
  );
}

// ------------------------------------------------------------------ 版のスレッド件数

/** 版と要約の件数が変わりうる更新か（リアクション・返信・担当・本文の訂正は件数に効かない） */
export function threadCountsMayChange(before: CommentThread, after: CommentThread): boolean {
  return (
    before.revisionId !== after.revisionId ||
    before.deletedAt !== after.deletedAt ||
    before.resolution !== after.resolution ||
    before.createdAt !== after.createdAt ||
    before.origin?.kind !== after.origin?.kind
  );
}

/** スレッドを書いたあと、版の unresolvedCount / openBotCount / threadCount と、制作物の要約を数え直す */
export function syncRevisionThreadStats(sql: Sql, revisionId: string): void {
  const [rev] = sql.exec(
    "SELECT json_extract(doc, '$.workId') AS workId, doc FROM revisions WHERE id = ?",
    revisionId,
  );
  // 無い版へのスレッドは書込みごと失敗させる（Convex と同じ）
  if (!rev) throw new Error(`revision not found: ${revisionId}`);
  const revision = JSON.parse(rev.doc as string) as Revision;
  const live = new Rows<CommentThread>(sql, "threads").select(
    "WHERE revisionId = ? AND deletedAt IS NULL ORDER BY rowid",
    revisionId,
  );
  const stats = revisionThreadStatsOf(live);
  if (
    revision.unresolvedCount !== stats.unresolved ||
    revision.openBotCount !== stats.openBot ||
    revision.threadCount !== stats.total
  )
    sql.exec(
      "UPDATE revisions SET doc = json_set(doc, '$.unresolvedCount', ?, '$.openBotCount', ?, '$.threadCount', ?) WHERE id = ?",
      stats.unresolved,
      stats.openBot,
      stats.total,
      revisionId,
    );
  syncWorkSummary(sql, revision.workId, { revisionId, liveThreads: live });
}

// ------------------------------------------------------------------ notificationCounters

/** 行が無いときに数える上限と、書込みのついでに行を作るために数える上限（Convex と同じ 100） */
export const FALLBACK_COUNT_LIMIT = 100;
export const LAZY_COUNT_LIMIT = 100;

const counters = (sql: Sql) =>
  new Rows<{ userId: string; unread: number }>(sql, "notificationCounters");

function countUnreadUpTo(sql: Sql, userId: string, limit: number): number {
  const [row] = sql.exec(
    "SELECT count(*) AS n FROM (SELECT 1 FROM notifications WHERE recipientId = ? AND readAt IS NULL LIMIT ?)",
    userId,
    limit,
  );
  return Number(row?.n ?? 0);
}

/** 未読の数。行があればその値、無ければ未読を FALLBACK_COUNT_LIMIT 件まで数える */
export function readUnreadCount(sql: Sql, userId: string): number {
  const row = counters(sql).select("WHERE id = ?", userId)[0];
  return row ? row.unread : countUnreadUpTo(sql, userId, FALLBACK_COUNT_LIMIT);
}

/**
 * 通知の行を書いた**後**に呼ぶ（delta は未読の増減）。行があれば増減し、無ければ書いた後の未読を数えて行を作る
 * （LAZY_COUNT_LIMIT 件を超えるなら作らない）。tooManyToCount は同じトランザクションで数え直さないための覚え
 */
export function adjustUnreadCounter(
  sql: Sql,
  userId: string,
  delta: number,
  tooManyToCount: Set<string>,
): void {
  if (delta === 0) return;
  const row = counters(sql).select("WHERE id = ?", userId)[0];
  if (row) {
    counters(sql).upsert(userId, { userId, unread: Math.max(0, row.unread + delta) });
    return;
  }
  if (tooManyToCount.has(userId)) return;
  const counted = countUnreadUpTo(sql, userId, LAZY_COUNT_LIMIT + 1);
  if (counted > LAZY_COUNT_LIMIT) {
    tooManyToCount.add(userId);
    return;
  }
  counters(sql).upsert(userId, { userId, unread: counted });
}
