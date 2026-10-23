import {
  countsDeclarations,
  focusRevisionIdOf,
  revisionHeadsOf,
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

/** Derived summaries are rebuilt inside the source mutation; legacy rows fall back until backfill. */
export async function syncWorkSummary(db: DatabaseWriter, workId: string) {
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
  const focusThreads = focusId
    ? (
        await db
          .query("commentThreads")
          .withIndex("by_revision", (q) => q.eq("revisionId", focusId as Id<"revisions">))
          .collect()
      ).filter((t) => t.deletedAt === undefined)
    : [];
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
