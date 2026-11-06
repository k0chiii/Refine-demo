import { revisionThreadStatsOf } from "@mf100/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseWriter } from "../_generated/server";
import { syncWorkSummary } from "./workSummary";

/** 版の件数（revisionThreadStatsOf）と要約の指摘の数（threadTallyOf）が読む、スレッドの項目 */
type CountedThread = Pick<
  Doc<"commentThreads">,
  "revisionId" | "deletedAt" | "resolution" | "createdAt" | "origin"
>;

/**
 * 更新の前後で、数える項目が変わったか。変わらなければ版の件数も要約も変わらないので同期しなくてよい
 * （リアクション・返信のやり取り・担当・本文の訂正などは件数に効かない）
 */
export function threadCountsMayChange(before: CountedThread, after: CountedThread): boolean {
  return (
    before.revisionId !== after.revisionId ||
    before.deletedAt !== after.deletedAt ||
    before.resolution !== after.resolution ||
    before.createdAt !== after.createdAt ||
    before.origin?.kind !== after.origin?.kind
  );
}

/** Rebuild derived thread counts on the revision and its work summary after a comment write. */
export async function syncRevisionThreadStats(db: DatabaseWriter, revisionId: string) {
  const id = revisionId as Id<"revisions">;
  const revision = await db.get(id);
  // 以前は patch が投げていた（無い版へのスレッドは書込みごと失敗させる）
  if (!revision) throw new Error(`revision not found: ${revisionId}`);
  const docs = await db
    .query("commentThreads")
    .withIndex("by_revision", (q) => q.eq("revisionId", id))
    .collect();
  const live = docs.filter((d) => d.deletedAt === undefined);
  const stats = revisionThreadStatsOf(live);
  // 同じ値の patch でも版を読んだ購読（revisions.get・版の一覧）が走り直すので、変わったときだけ書く
  if (
    revision.unresolvedCount !== stats.unresolved ||
    revision.openBotCount !== stats.openBot ||
    revision.threadCount !== stats.total
  )
    await db.patch(id, {
      unresolvedCount: stats.unresolved,
      openBotCount: stats.openBot,
      threadCount: stats.total,
    });
  // 要約の数える版がこの版なら、読んだスレッドをそのまま渡す（同じスレッドを 2 回読まない）
  await syncWorkSummary(db, revision.workId, { revisionId: id, liveThreads: live });
}
