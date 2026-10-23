import { revisionThreadStatsOf } from "@mf100/domain";
import type { Id } from "../_generated/dataModel";
import type { DatabaseWriter } from "../_generated/server";

/** Rebuild derived thread counts on the revision after a comment write. */
export async function syncRevisionThreadStats(db: DatabaseWriter, revisionId: string) {
  const docs = await db
    .query("commentThreads")
    .withIndex("by_revision", (q) => q.eq("revisionId", revisionId as Id<"revisions">))
    .collect();
  const live = docs.filter((d) => d.deletedAt === undefined);
  const stats = revisionThreadStatsOf(live);
  await db.patch(revisionId as Id<"revisions">, {
    unresolvedCount: stats.unresolved,
    openBotCount: stats.openBot,
    threadCount: stats.total,
  });
}
