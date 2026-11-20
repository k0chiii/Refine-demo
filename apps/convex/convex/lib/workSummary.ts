import {
  countsDeclarations,
  focusRevisionIdOf,
  revisionHeadsOf,
  workProgressOf,
  workSummaryOf,
  type ApprovalEvent,
  type Revision,
  type WorkSummary,
} from "@mf100/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseWriter } from "../_generated/server";
import { workFromDoc } from "./adapters";

/** この版より古い行（id だけの要約）は信用せず、読む側が版から数え直す */
export const WORK_SUMMARY_VERSION = 2;

export function workSummaryFromDoc(doc: Doc<"workSummaries">): WorkSummary | null {
  const { summaryVersion, latest, accepting, threads, declared } = doc;
  if (
    summaryVersion === undefined ||
    summaryVersion < WORK_SUMMARY_VERSION ||
    latest === undefined ||
    accepting === undefined ||
    threads === undefined
  )
    return null;
  return { latest, accepting, threads, declared };
}

/** 呼び出し側がこのトランザクションで読み終えた、ある版の削除されていないスレッド */
export interface KnownRevisionThreads {
  revisionId: Id<"revisions">;
  liveThreads: ReadonlyArray<Pick<Doc<"commentThreads">, "resolution" | "createdAt">>;
}

/**
 * Derived summaries are rebuilt inside the source mutation; legacy rows fall back until backfill.
 * `known` がこの制作物の数える版のスレッドなら、それを使って同じスレッドを読み直さない。
 */
export async function syncWorkSummary(
  db: DatabaseWriter,
  workId: string,
  known?: KnownRevisionThreads,
) {
  const workDoc = await db.get("works", workId as Id<"works">);
  if (!workDoc) return;
  const work = workFromDoc(workDoc);
  const rows = await db
    .query("revisions")
    .withIndex("by_work", (q) => q.eq("workId", workDoc._id))
    .collect();
  const revisions = rows.map(({ _id, _creationTime, ...rest }) => ({
    ...rest,
    id: _id,
  })) as Revision[];
  const focusId = focusRevisionIdOf(revisionHeadsOf(revisions));
  const focusThreads = !focusId
    ? []
    : known && known.revisionId === focusId
      ? known.liveThreads
      : await db
          .query("commentThreads")
          .withIndex("by_revision_deleted", (q) =>
            q.eq("revisionId", focusId as Id<"revisions">).eq("deletedAt", undefined),
          )
          .collect();
  const approvalEvents = countsDeclarations(work)
    ? ((await db
        .query("approvalEvents")
        .withIndex("by_work", (q) => q.eq("workId", workDoc._id))
        .collect()) as ApprovalEvent[])
    : [];
  const summary = workSummaryOf({ work, revisions, focusThreads, approvalEvents });
  const value = {
    workId: workDoc._id,
    latestId: summary.latest?.id ?? null,
    acceptingId: summary.accepting?.id ?? null,
    summaryVersion: WORK_SUMMARY_VERSION,
    ...summary,
  };
  const existing = await db
    .query("workSummaries")
    .withIndex("by_work", (q) => q.eq("workId", workDoc._id))
    .unique();
  if (!existing) await db.insert("workSummaries", value);
  else {
    const { _id, _creationTime, ...stored } = existing;
    void _creationTime;
    if (!sameValue(stored, value)) await db.replace(_id, value);
  }
  // 読んだスレッドを渡されたとき（スレッドの書込み）は、版の受付状態も割当・専門確認も変わらないので進み具合は触らない
  if (!known) await syncWorkProgress(db, workDoc._id, summary.accepting?.id ?? null);
}

/**
 * 受付中の版の校正の進み具合（workProgress）を、その版の割当・専門確認から作り直す。
 * 呼ぶのは、受付中の版が変わりうる書込み（syncWorkSummary）と、割当・専門確認の書込み。変わらなければ書かない
 */
export async function syncWorkProgress(
  db: DatabaseWriter,
  workId: Id<"works">,
  acceptingId: string | null,
) {
  const revisionId = acceptingId as Id<"revisions"> | null;
  const progress = workProgressOf({
    assignments: revisionId
      ? await db
          .query("reviewAssignments")
          .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
          .collect()
      : [],
    checks: revisionId
      ? await db
          .query("requiredChecks")
          .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
          .collect()
      : [],
  });
  const value = { workId, acceptingId, ...progress };
  const existing = await db
    .query("workProgress")
    .withIndex("by_work", (q) => q.eq("workId", workId))
    .unique();
  if (!existing) await db.insert("workProgress", value);
  else {
    const { _id, _creationTime, ...stored } = existing;
    void _creationTime;
    if (!sameValue(stored, value)) await db.replace(_id, value);
  }
}

/** 割当・専門確認を書いたあとに呼ぶ。その版が受付中なら、制作物の進み具合を作り直す（受付中でない版は数えない） */
export async function syncWorkProgressOfRevision(db: DatabaseWriter, revisionId: string) {
  const revision = await db.get("revisions", revisionId as Id<"revisions">);
  if (revision && revision.reviewState === "open")
    await syncWorkProgress(db, revision.workId, revision._id);
}

/** Skipping no-op replaces keeps list/dashboard subscriptions from re-running; stored key order is not ours. */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return a === b;
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}
