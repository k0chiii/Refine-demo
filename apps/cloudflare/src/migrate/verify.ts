import type { Sql } from "../sqlite/sql.ts";
import { STORAGE } from "./plan.ts";

/**
 * 取り込んだあとの確認。本番の取り込みの前後に走らせ、問題が 0 件になってから切り替える。
 * 取り込み先の SQLite だけを見る（Convex には触れない）。
 */
export interface Problem {
  /** count: 件数の食い違い / subject: users の本人の特定 / ref: 参照の欠け / inflight: 進行中の仕事 / derived: 派生表の欠け */
  check: "count" | "subject" | "ref" | "inflight" | "derived";
  table: string;
  /** 行の ID（keyless の表は `rowid:n`、表全体の問題は空） */
  id: string;
  detail: string;
}

/** 参照の 1 本。field は doc の項目（raw の表は列）。array は配列の項目、where はこの参照が当たる行の条件 */
interface Ref {
  table: string;
  field: string;
  to: string;
  array?: true;
  where?: string;
}

/**
 * 参照の欠けを探す対象。Convex の `v.id(...)` と、ID を文字列で持つ項目のうち、指す先が 1 つに決まるもの。
 * users を指す項目は "system" と "bot:*"（システムの投稿者。users に居ない）を除く。
 */
export const REFS: readonly Ref[] = [
  { table: "works", field: "creatorIds", to: "users", array: true },
  { table: "works", field: "managerIds", to: "users", array: true },
  { table: "works", field: "approverId", to: "users" },
  { table: "works", field: "approverIds", to: "users", array: true },
  { table: "works", field: "reviewerIds", to: "users", array: true },
  { table: "works", field: "socialProfileId", to: "socialProfiles" },
  { table: "works", field: "ownerTeamId", to: "teams" },
  { table: "works", field: "productionTeamIds", to: "teams", array: true },
  { table: "works", field: "relatedTeamIds", to: "teams", array: true },
  { table: "revisions", field: "workId", to: "works" },
  { table: "artifacts", field: "revisionId", to: "revisions" },
  { table: "uploadSessions", field: "workId", to: "works" },
  { table: "uploadItems", field: "sessionId", to: "uploadSessions" },
  { table: "threads", field: "revisionId", to: "revisions" },
  { table: "events", field: "threadId", to: "threads" },
  { table: "commentReads", field: "threadId", to: "threads" },
  { table: "commentReads", field: "userId", to: "users" },
  { table: "threadSubscriptions", field: "threadId", to: "threads" },
  { table: "threadSubscriptions", field: "userId", to: "users" },
  { table: "assignments", field: "revisionId", to: "revisions" },
  { table: "assignments", field: "reviewerId", to: "users" },
  { table: "checks", field: "revisionId", to: "revisions" },
  { table: "grants", field: "workId", to: "works" },
  { table: "grants", field: "principalId", to: "users", where: "principalType = 'user'" },
  { table: "grants", field: "principalId", to: "memberGroups", where: "principalType = 'group'" },
  { table: "approvals", field: "workId", to: "works" },
  { table: "confirmations", field: "workId", to: "works" },
  { table: "confirmations", field: "revisionId", to: "revisions" },
  { table: "confirmations", field: "confirmerId", to: "users" },
  { table: "notifications", field: "recipientId", to: "users" },
  { table: "pushSubscriptions", field: "userId", to: "users" },
  { table: "documents", field: "workId", to: "works" },
  { table: "alignments", field: "workId", to: "works" },
  { table: "runs", field: "revisionId", to: "revisions" },
  { table: "commentFiles", field: "workId", to: "works" },
  { table: "feedbackThreads", field: "workId", to: "works" },
  { table: "feedbackPosts", field: "threadId", to: "feedbackThreads" },
  { table: "pins", field: "workId", to: "works" },
  { table: "pins", field: "userId", to: "users" },
  { table: "managers", field: "userId", to: "users" },
  { table: "rules", field: "categoryCode", to: "categories" },
  { table: "collaborativeDrafts", field: "workId", to: "works" },
];

/** 全部の表の行数（取り込みの前後と、export の数の突き合わせに使う）。作り直した派生表も数える */
export function tableCounts(sql: Sql): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of [
    ...Object.keys(STORAGE),
    "workRoles",
    "workSummaries",
    "notificationCounters",
  ])
    out[table] = Number(sql.exec(`SELECT count(*) AS n FROM ${table}`)[0]?.n ?? 0);
  return out;
}

const SYSTEM_ACTOR = "(v = 'system' OR v LIKE 'bot:%')";

/**
 * 問題の一覧（空なら取り込みは整合している）。
 * - count: expected（export が数えた表ごとの行数）と、いまの行数が違う
 * - subject: users に subject が無い行・重複
 * - ref: REFS の参照が指す先が無い（users から外れた人を指す制作物など）
 * - inflight: 進行中の処理の台帳（Convex の仕事に結び付いていて、移しても続きは動かない）
 * - derived: 制作物に要約の行が無い（作り直しが走っていない）
 */
export function verifySnapshot(sql: Sql, expected?: Record<string, number>): Problem[] {
  const problems: Problem[] = [];

  if (expected) {
    const actual = tableCounts(sql);
    for (const [table, n] of Object.entries(expected))
      if (actual[table] !== n)
        problems.push({
          check: "count",
          table,
          id: "",
          detail: `export は ${n} 行、取り込み先は ${actual[table] ?? "表なし"} 行`,
        });
  }

  for (const r of sql.exec(
    "SELECT id FROM users WHERE json_extract(doc, '$.subject') IS NULL OR json_extract(doc, '$.subject') = ''",
  ))
    problems.push({
      check: "subject",
      table: "users",
      id: r.id as string,
      detail: "subject が無い",
    });
  for (const r of sql.exec(
    `SELECT json_extract(doc, '$.subject') AS s, count(*) AS n FROM users
     WHERE json_extract(doc, '$.subject') IS NOT NULL GROUP BY s HAVING n > 1`,
  ))
    problems.push({
      check: "subject",
      table: "users",
      id: r.s as string,
      detail: `subject が ${String(r.n)} 人で重なっている`,
    });

  for (const ref of REFS) {
    const raw = STORAGE[ref.table]?.kind === "raw";
    const keyless = STORAGE[ref.table]?.kind === "keyless";
    const scalar = raw ? `t.${ref.field}` : `json_extract(t.doc, '$.${ref.field}')`;
    const value = ref.array ? "j.value" : scalar;
    const idOf = raw ? `t.${ref.field}` : keyless ? "'rowid:' || t.rowid" : "t.id";
    const from = ref.array
      ? `${ref.table} t, json_each(t.doc, '$.${ref.field}') j`
      : `${ref.table} t`;
    const rows = sql.exec(
      `SELECT * FROM (SELECT ${idOf} AS rid, ${value} AS v FROM ${from}
         ${ref.where ? `WHERE ${ref.where}` : ""})
       WHERE v IS NOT NULL AND v != ''
         ${ref.to === "users" ? `AND NOT ${SYSTEM_ACTOR}` : ""}
         AND NOT EXISTS (SELECT 1 FROM ${ref.to} p WHERE p.id = v)`,
    );
    for (const r of rows)
      problems.push({
        check: "ref",
        table: ref.table,
        id: String(r.rid),
        detail: `${ref.field} の ${String(r.v)} が ${ref.to} に無い`,
      });
  }

  for (const r of sql.exec(
    "SELECT id, state FROM processingJobs WHERE state IN ('queued', 'running')",
  ))
    problems.push({
      check: "inflight",
      table: "processingJobs",
      id: r.id as string,
      detail: `${String(r.state)} のまま（Convex の仕事に結び付いていて、続きは動かない）`,
    });

  for (const r of sql.exec(
    "SELECT id FROM works WHERE NOT EXISTS (SELECT 1 FROM workSummaries s WHERE s.id = works.id)",
  ))
    problems.push({
      check: "derived",
      table: "workSummaries",
      id: r.id as string,
      detail: "要約の行が無い（rebuildDerived が走っていない）",
    });

  return problems;
}
