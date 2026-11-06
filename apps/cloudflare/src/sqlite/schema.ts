import type { Sql } from "./sql.ts";

/**
 * 文書テーブル方式: 行は JSON 1 つ（doc）。ドメインの型が育っても列を足さずに済む。
 * 検索に使う項目だけを生成列にして index を張る（doc から引くので二重に持たない）。
 *
 * 主キー:
 * - 既定は `id TEXT PRIMARY KEY`。自然キーの行（利用者×スレッドなど）は id に `a|b` を入れて upsert する。
 * - keyless は追記だけの行（rowid が順序の正）。
 */
export interface TableSpec {
  name: string;
  keyless?: true;
  /** doc の同名の項目を生成列にする */
  cols?: readonly string[];
  /** index を張る列の組 */
  indexes?: readonly (readonly string[])[];
  /** 一意 index を張る列の組（NULL は重複してよい） */
  unique?: readonly (readonly string[])[];
}

export const TABLES: readonly TableSpec[] = [
  // id は払い出した利用者 ID（Principal.userId）。subject は Nogiku の sub で、本人の特定（subject → id）にだけ使う
  { name: "users", cols: ["name", "email", "nameKanji", "subject"], unique: [["subject"]] },
  {
    name: "works",
    cols: ["socialProfileId", "ownerTeamId", "year", "lifecycle"],
    indexes: [["socialProfileId"], ["year", "lifecycle"]],
  },
  {
    name: "revisions",
    cols: ["workId", "reviewState", "deadlineAt"],
    indexes: [["workId"], ["reviewState", "deadlineAt"]],
  },
  { name: "artifacts", cols: ["revisionId"], indexes: [["revisionId"]] },
  {
    name: "uploadSessions",
    cols: ["state", "expiresAt", "purgedAt"],
    indexes: [["state", "expiresAt"]],
  },
  { name: "uploadItems", cols: ["sessionId"], indexes: [["sessionId"]] },
  {
    name: "uploadAttempts",
    cols: ["target", "targetId", "state", "createdAt", "purgedAt"],
    indexes: [["target", "targetId"], ["state"]],
  },
  {
    name: "threads",
    cols: ["revisionId", "deletedAt", "migratedFromFeedbackThreadId"],
    indexes: [["revisionId"], ["migratedFromFeedbackThreadId"]],
  },
  { name: "events", cols: ["threadId"], indexes: [["threadId"]] },
  { name: "commentReads", cols: ["userId", "threadId"], indexes: [["userId"]] },
  { name: "threadSubscriptions", cols: ["userId", "threadId"], indexes: [["threadId"]] },
  {
    name: "assignments",
    cols: ["revisionId", "reviewerId"],
    indexes: [["revisionId"], ["reviewerId"]],
  },
  {
    name: "grants",
    keyless: true,
    cols: ["workId", "principalType", "principalId"],
    indexes: [["workId"], ["principalType", "principalId"]],
  },
  { name: "approvals", keyless: true, cols: ["workId"], indexes: [["workId"]] },
  {
    name: "confirmations",
    cols: ["revisionId", "confirmedAt"],
    indexes: [["revisionId"]],
  },
  {
    name: "checks",
    cols: ["revisionId", "assigneeId"],
    indexes: [["revisionId"], ["assigneeId"]],
  },
  {
    name: "notifications",
    cols: ["recipientId", "readAt", "createdAt"],
    indexes: [
      ["recipientId", "createdAt"],
      ["recipientId", "readAt"],
    ],
  },
  { name: "pushSubscriptions", cols: ["userId", "endpoint"], indexes: [["userId"], ["endpoint"]] },
  { name: "notificationPrefs" },
  { name: "deliveries", cols: ["notificationId"], indexes: [["notificationId"]] },
  { name: "slackWorkspaces", cols: ["name", "teamId"], indexes: [["teamId"]] },
  { name: "slackMembers" },
  { name: "documents", cols: ["workId"], indexes: [["workId"]] },
  { name: "socialProfiles" },
  { name: "teams" },
  { name: "memberGroups" },
  {
    name: "alignments",
    cols: ["leftArtifactId", "rightArtifactId"],
    indexes: [["leftArtifactId"]],
  },
  { name: "categories" },
  { name: "rules", cols: ["categoryCode"], indexes: [["categoryCode"]] },
  { name: "ruleRevisions", keyless: true, cols: ["ruleId"], indexes: [["ruleId"]] },
  { name: "managers" },
  {
    name: "proposals",
    cols: ["status", "dedupeKey", "proposedAt"],
    indexes: [["status", "dedupeKey"]],
  },
  { name: "runs", cols: ["revisionId"], indexes: [["revisionId"]] },
  { name: "pins", cols: ["userId", "workId", "pinnedAt"], indexes: [["userId"], ["workId"]] },
  { name: "feedbackThreads" },
  { name: "feedbackPosts", cols: ["threadId", "createdAt"], indexes: [["threadId"]] },
  { name: "feedbackFiles" },
  { name: "feedbackReads", cols: ["threadId"], indexes: [["threadId"]] },
  {
    name: "commentFiles",
    cols: ["threadId", "createdAt", "abandonedAt", "removedAt", "purgedAt"],
    indexes: [["threadId"]],
  },
  // ---- 派生表（書き込みと同じトランザクションで作り直す。sqlite/derived.ts。Convex の lib/adapters.ts と同じ契約）
  // 制作物ごとの要約。id は workId。acceptingId から「受付中の版の制作物」を引く（ダッシュボードの候補）
  { name: "workSummaries", cols: ["acceptingId"], indexes: [["acceptingId"]] },
  // 制作者・統括・校了者の職責の索引（by_user で「自分に関係する制作物」を引く）。id は workId|role|userId
  { name: "workRoles", cols: ["workId", "userId"], indexes: [["userId"], ["workId"]] },
  // 利用者ごとの未読の通知の数。id は userId
  { name: "notificationCounters" },
  { name: "audit", keyless: true },
  { name: "idempotency" },
];

function createTable(t: TableSpec): string {
  const generated = (t.cols ?? []).map(
    (c) => `${c} GENERATED ALWAYS AS (json_extract(doc, '$.${c}')) VIRTUAL`,
  );
  const head = t.keyless ? [] : ["id TEXT PRIMARY KEY"];
  return `CREATE TABLE IF NOT EXISTS ${t.name} (${[...head, "doc TEXT NOT NULL", ...generated].join(", ")})`;
}

/**
 * 全文検索の仮想表（FTS5）。TABLES の「doc 1 つの表」ではないので別に持つ。名前は書き込みと読みの追跡（run.ts）が使う。
 * tokens は 1/2-gram の token（sqlite/workSearch.ts）。rowid は works の rowid と揃える（並びと、行の引き直しのため）
 */
export const FTS_TABLES: readonly string[] = ["workSearch"];

/**
 * 何度呼んでも同じ（CREATE ... IF NOT EXISTS だけ）。
 * ponytail: 既にある表へ列は足さない。手元の `.wrangler/state` が古ければ消す（本番の DO はまだ無い）
 */
export function migrate(sql: Sql): void {
  for (const t of TABLES) {
    sql.exec(createTable(t));
    for (const cols of t.indexes ?? [])
      sql.exec(
        `CREATE INDEX IF NOT EXISTS ix_${t.name}_${cols.join("_")} ON ${t.name} (${cols.join(", ")})`,
      );
    for (const cols of t.unique ?? [])
      sql.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS ux_${t.name}_${cols.join("_")} ON ${t.name} (${cols.join(", ")})`,
      );
  }
  sql.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS workSearch USING fts5(tokens, workId UNINDEXED, year UNINDEXED, lifecycle UNINDEXED)",
  );
}
