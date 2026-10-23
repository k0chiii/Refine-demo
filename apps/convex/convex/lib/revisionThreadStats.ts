import { revisionThreadStatsOf } from "@mf100/domain";
import type { Id } from "../_generated/dataModel";
import type { DatabaseWriter } from "../_generated/server";
import { syncWorkSummary } from "./workSummary";

/** Rebuild derived thread counts on the revision and its work summary after a comment write. */
export async function syncRevisionThreadStats(db: DatabaseWriter, revisionId: string) {
  const id = revisionId as Id<"revisions">;
  const docs = await db
    .query("commentThreads")
    .withIndex("by_revision", (q) => q.eq("revisionId", id))
    .collect();
  const live = docs.filter((d) => d.deletedAt === undefined);
  const stats = revisionThreadStatsOf(live);
  await db.patch(id, {
    unresolvedCount: stats.unresolved,
    openBotCount: stats.openBot,
    threadCount: stats.total,
  });
  const revision = await db.get(id);
  if (revision) await syncWorkSummary(db, revision.workId);
}
