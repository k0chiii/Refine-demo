import { NO_TEAM } from "@mf100/application";
import type { DatabaseReader, DatabaseWriter } from "../_generated/server";

/**
 * 校了した制作物の数（主管担当ごと）。派生データ: 制作物を書くただ 1 つの経路（アダプタの works.insert / update）が、
 * 同じ transaction で増減する。全体の状況（dashboard.works）が、校了した制作物の文書を 1 件ずつ読まずに数だけで足せる。
 * 行が無い間（埋め直す前）は読む側が全件を読んで数える。鍵は主管担当の ID、未設定は {@link NO_TEAM}。
 */
const NAME = "finalizedByTeam" as const;

type CountedWork = { lifecycle: string; ownerTeamId?: string | undefined };

const keyOf = (work: CountedWork | null): string | null =>
  work && work.lifecycle === "finalized" ? (work.ownerTeamId ?? NO_TEAM) : null;

async function rowOf(db: DatabaseReader) {
  return db
    .query("workCounters")
    .withIndex("by_name", (q) => q.eq("name", NAME))
    .unique();
}

/** 数を読む。行が無ければ null（埋め直す前。呼び出し側は全件から数える） */
export async function readFinalizedCounts(
  db: DatabaseReader,
): Promise<Record<string, number> | null> {
  return (await rowOf(db))?.counts ?? null;
}

/** 制作物を書いたあとに呼ぶ。校了の有無・主管担当が変わったときだけ、数を増減する（行が無ければ何もしない） */
export async function adjustFinalizedCount(
  db: DatabaseWriter,
  before: CountedWork | null,
  after: CountedWork,
) {
  const was = keyOf(before);
  const now = keyOf(after);
  if (was === now) return;
  const row = await rowOf(db);
  if (!row) return;
  const counts = { ...row.counts };
  if (was !== null) {
    const left = (counts[was] ?? 0) - 1;
    if (left > 0) counts[was] = left;
    else delete counts[was];
  }
  if (now !== null) counts[now] = (counts[now] ?? 0) + 1;
  await db.patch(row._id, { counts });
}

const sorted = (r: Record<string, number>) =>
  Object.entries(r).sort(([a], [b]) => a.localeCompare(b));

/** 校了した制作物から数え直す（埋め直しと、照合のテスト用）。変わらなければ書かない */
export async function rebuildFinalizedCounts(db: DatabaseWriter): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for await (const work of db
    .query("works")
    .withIndex("by_lifecycle", (q) => q.eq("lifecycle", "finalized"))) {
    const key = keyOf(work)!;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const row = await rowOf(db);
  if (!row) await db.insert("workCounters", { name: NAME, counts });
  else if (JSON.stringify(sorted(row.counts)) !== JSON.stringify(sorted(counts)))
    await db.replace(row._id, { name: NAME, counts });
  return counts;
}
