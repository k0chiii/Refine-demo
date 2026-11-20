import { isAccepting, type Revision } from "@mf100/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "../_generated/server";

/**
 * 校正の割当（reviewAssignments）に持たせる「割当先の版が受付中か」（revisionOpen）の同期と、読む側の引き方。
 *
 * 版が閉じても割当は pending / viewed のまま残る（業務の状態は変えない）。「自分の受付中の割当」を割当の全件と版から探すと、
 * 履歴が増えるほど読む量が増え、版の書込み（指摘の件数の更新）のたびに再実行される。そこで、版の受付状態を書く唯一の経路
 * （adapters の `revisions.update`）と割当の書込み（`assignments.upsert`）が、同じ transaction でこの印を揃える。
 * 読む側は印の索引（by_reviewer_open_state）で受付中の割当だけを引く。印の無い古い行は {@link legacyAssignmentRevisionIds}
 * が拾い、版から確かめる（`internal.migrations.backfillAssignmentOpen` を流すと無くなる）。
 */

/** 版の文書から受付中かを決める（domain の isAccepting と同じ） */
export function isRevisionDocOpen(revision: Pick<Doc<"revisions">, "reviewState">): boolean {
  return isAccepting(revision as unknown as Revision);
}

export async function revisionOpenOf(
  db: DatabaseReader,
  revisionId: Id<"revisions">,
): Promise<boolean> {
  const revision = await db.get("revisions", revisionId);
  return revision !== null && isRevisionDocOpen(revision);
}

/** 版の受付状態が変わったとき、その版の割当の印を揃える（変わらない行は書かない） */
export async function syncAssignmentsOpen(
  db: DatabaseWriter,
  revisionId: Id<"revisions">,
  open: boolean,
): Promise<void> {
  const rows = await db
    .query("reviewAssignments")
    .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
    .collect();
  for (const row of rows)
    if (row.revisionOpen !== open) await db.patch(row._id, { revisionOpen: open });
}

type AssignmentState = Doc<"reviewAssignments">["state"];

/**
 * 自分の割当のうち、受付中の版のものの版 ID（割当 1 件につき 1 つ。states を省くと全ての状態）。
 * - open: 印が付いた行。受付中と分かっているので版は読まない（索引の範囲だけ）
 * - legacy: 印の無い古い行（backfillAssignmentOpen を流し終えれば空）。受付中とは限らないので、呼び出し側が {@link acceptingWorkOf} で確かめる
 */
export async function openAssignmentRevisionIds(
  db: DatabaseReader,
  userId: string,
  states?: readonly AssignmentState[],
): Promise<{ open: Id<"revisions">[]; legacy: Id<"revisions">[] }> {
  const open: Id<"revisions">[] = [];
  if (states === undefined) {
    for await (const row of db
      .query("reviewAssignments")
      .withIndex("by_reviewer_open_state", (q) =>
        q.eq("reviewerId", userId).eq("revisionOpen", true),
      ))
      open.push(row.revisionId);
  } else {
    for (const state of states)
      for await (const row of db
        .query("reviewAssignments")
        .withIndex("by_reviewer_open_state", (q) =>
          q.eq("reviewerId", userId).eq("revisionOpen", true).eq("state", state),
        ))
        open.push(row.revisionId);
  }
  const legacy: Id<"revisions">[] = [];
  for (const row of await legacyAssignmentRows(db, userId, states)) legacy.push(row.revisionId);
  return { open, legacy };
}

/** 印の無い古い割当（backfillAssignmentOpen を流し終えれば空）。状態を絞れば、その状態の行だけ読む */
async function legacyAssignmentRows(
  db: DatabaseReader,
  userId: string,
  states: readonly AssignmentState[] | undefined,
) {
  const rows: Doc<"reviewAssignments">[] = [];
  if (states === undefined) {
    for await (const row of db
      .query("reviewAssignments")
      .withIndex("by_reviewer_open_state", (q) =>
        q.eq("reviewerId", userId).eq("revisionOpen", undefined),
      ))
      rows.push(row);
  } else {
    for (const state of states)
      for await (const row of db
        .query("reviewAssignments")
        .withIndex("by_reviewer_open_state", (q) =>
          q.eq("reviewerId", userId).eq("revisionOpen", undefined).eq("state", state),
        ))
        rows.push(row);
  }
  return rows;
}

/**
 * 受付中の版なら、その制作物の ID。受付中でなければ null。
 * 受付中の版は制作物の要約が acceptingId で持つので、まず要約の索引で引く（当たれば版は読まない）。
 * 当たらないのは「受付中でない」か「要約の無い古い制作物」なので、版を読んで確かめる。
 * 印の無い古い割当と、専門確認の担当（印を持たない）の確かめに使う。
 */
export async function acceptingWorkOf(
  db: DatabaseReader,
  revisionId: Id<"revisions">,
): Promise<Id<"works"> | null> {
  const summary = await db
    .query("workSummaries")
    .withIndex("by_acceptingId", (q) => q.eq("acceptingId", revisionId))
    .first();
  if (summary) return summary.workId;
  const revision = await db.get("revisions", revisionId);
  if (!revision || !isRevisionDocOpen(revision)) return null;
  const own = await db
    .query("workSummaries")
    .withIndex("by_work", (q) => q.eq("workId", revision.workId))
    .unique();
  // 要約があるのに受付中の版が違う（＝この版は受付中でない）なら受付中にしない
  return !own || own.acceptingId === null || own.acceptingId === revisionId
    ? revision.workId
    : null;
}

/** 割当 1 件の印を、版の今の状態に揃える（移行・テストの照合用） */
export async function rebuildAssignmentOpen(
  db: DatabaseWriter,
  row: Doc<"reviewAssignments">,
): Promise<void> {
  const open = await revisionOpenOf(db, row.revisionId);
  if (row.revisionOpen !== open) await db.patch(row._id, { revisionOpen: open });
}
