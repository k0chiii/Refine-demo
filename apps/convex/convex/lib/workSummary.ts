import {
  approvalProgressOf,
  approvalSetupOf,
  isAccepting,
  type ApprovalEvent,
  type Revision,
} from "@mf100/domain";
import type { Id } from "../_generated/dataModel";
import type { DatabaseWriter } from "../_generated/server";
import { workFromDoc } from "./adapters";

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
  const accepting = revisions.find(isAccepting) ?? null;
  const latest =
    revisions
      .filter((r) => r.reviewState !== "void")
      .sort((a, b) => b.submittedAt - a.submittedAt)[0] ?? null;
  let declared = 0;
  if (work.lifecycle === "active" && approvalSetupOf(work).quorum > 1) {
    const events = await db
      .query("approvalEvents")
      .withIndex("by_work", (q) => q.eq("workId", workDoc._id))
      .collect();
    declared = approvalProgressOf(work, events as ApprovalEvent[], revisions).declaredIds.length;
  }
  const value = {
    workId: workDoc._id,
    latestId: latest?.id ?? null,
    acceptingId: accepting?.id ?? null,
    declared,
  };
  const existing = await db
    .query("workSummaries")
    .withIndex("by_work", (q) => q.eq("workId", workDoc._id))
    .unique();
  if (existing) {
    if (
      existing.latestId !== value.latestId ||
      existing.acceptingId !== value.acceptingId ||
      existing.declared !== declared
    )
      await db.replace(existing._id, value);
  } else await db.insert("workSummaries", value);
}
