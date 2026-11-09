import type { Sql, SqlParam } from "../sqlite/sql.ts";
import { noteSkip, STORAGE, type Doc, type MigrateRow, type Skipped } from "./plan.ts";
import { rebuildDerived } from "./rebuild.ts";
import { tableCounts, verifySnapshot, type Problem } from "./verify.ts";

/** HTTP から届く行。形は MigrateRow と同じだが、境界なので実行時に確かめる */
export type ImportRow = MigrateRow;

export interface ImportResult {
  /** 表ごとに書いた行の数 */
  counts: Record<string, number>;
  skipped: Skipped;
}

const isDoc = (v: unknown): v is Doc => typeof v === "object" && v !== null && !Array.isArray(v);

/** 報告に添える行の目印（ID。無ければ空） */
function labelOf(row: unknown): string {
  if (!isDoc(row)) return "";
  if (typeof row.id === "string") return row.id;
  return isDoc(row.doc) && typeof row.doc.id === "string" ? row.doc.id : "";
}

/**
 * 行を表へ書く（派生表は作り直さない）。同じ行を何度入れても同じ結果（冪等）:
 * - id のある表は upsert。`INSERT OR REPLACE` ではなく ON CONFLICT DO UPDATE にしたのは、REPLACE が行を消して入れ直し、
 *   rowid（= 追加順）が変わるため。再実行で並びが変わると feedback の pageThreads（OFFSET）が頼る順序を壊す
 * - keyless の表（grants・approvals・ruleRevisions・audit）は行を特定できないので upsert できない。入れ直しは resetKeyless で先に空にする
 * - 表の名前は STORAGE にあるものだけ、raw の列は columns にあるものだけを SQL に載せる（名前を値から組み立てるので許可表で絞る）
 */
export function importRows(sql: Sql, rows: Iterable<ImportRow>): ImportResult {
  const counts: Record<string, number> = {};
  const skipped: Skipped = {};
  for (const row of rows) {
    const table = typeof row?.table === "string" ? row.table : "";
    const storage = Object.hasOwn(STORAGE, table) ? STORAGE[table] : undefined;
    if (!storage) {
      noteSkip(skipped, `${table || "(表なし)"}: unknown-table`, labelOf(row));
      continue;
    }
    if (!isDoc(row.doc)) {
      noteSkip(skipped, `${table}: malformed`, labelOf(row));
      continue;
    }
    const reason = write(sql, table, storage, row);
    if (reason) noteSkip(skipped, `${table}: ${reason}`, labelOf(row));
    else counts[table] = (counts[table] ?? 0) + 1;
  }
  return { counts, skipped };
}

/** 書けなかった理由（書けたら null） */
function write(
  sql: Sql,
  table: string,
  storage: (typeof STORAGE)[string],
  row: ImportRow,
): string | null {
  const { doc } = row;
  switch (storage.kind) {
    case "keyless":
      sql.exec(`INSERT INTO ${table} (doc) VALUES (?)`, JSON.stringify(doc));
      return null;
    case "raw": {
      const columns = Object.keys(doc);
      const values: SqlParam[] = [];
      for (const c of columns) {
        const v = doc[c];
        if (!storage.columns.includes(c) || !(typeof v === "string" || typeof v === "number"))
          return "bad-column";
        values.push(v);
      }
      if (!storage.key.every((k) => columns.includes(k))) return "bad-column";
      const update = columns.filter((c) => !storage.key.includes(c));
      sql.exec(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
         ON CONFLICT (${storage.key.join(", ")}) DO ${
           update.length === 0
             ? "NOTHING"
             : `UPDATE SET ${update.map((c) => `${c} = excluded.${c}`).join(", ")}`
         }`,
        ...values,
      );
      return null;
    }
    case "docs":
    case "keyed": {
      const id = storage.kind === "docs" ? doc.id : row.id;
      if (typeof id !== "string" || id === "") return "no-id";
      if (table === "users") {
        // Cloudflare に先にサインインした人が、同じ subject を別の id で持っている。unique index に当たって全体が落ちないよう、その 1 行だけ避ける
        // （移行の前にサインインさせない運用が正しい。ここで id を付け替えると、その人が書いた行が宙に浮く）
        const [taken] = sql.exec(
          "SELECT id FROM users WHERE json_extract(doc, '$.subject') = ? AND id != ?",
          typeof doc.subject === "string" ? doc.subject : "",
          id,
        );
        if (taken) return "subject-taken-by-other-id";
      }
      sql.exec(
        `INSERT INTO ${table} (id, doc) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET doc = excluded.doc`,
        id,
        JSON.stringify(doc),
      );
      return null;
    }
  }
}

/**
 * keyless の表を空にする。取り込みの最初に 1 回（分割して送るときは begin の 1 通目だけ）。
 * 取り込み先は切り替え前の空の DO が前提で、そこで先に書かれた audit などは消える。
 */
export function resetKeyless(sql: Sql): void {
  for (const [table, storage] of Object.entries(STORAGE))
    if (storage.kind === "keyless") sql.exec(`DELETE FROM ${table}`);
}

/**
 * 1 回で全部入れる版（テスト・小さな取り込み）: 空にする → 入れる → 派生表を作り直す。
 * 何度呼んでも同じ件数・同じ内容になる。
 */
export function importSnapshot(sql: Sql, rows: Iterable<ImportRow>): ImportResult {
  resetKeyless(sql);
  const result = importRows(sql, rows);
  rebuildDerived(sql);
  return result;
}

export interface ImportChunkOptions {
  /** 最初の塊: keyless の表を空にする */
  begin: boolean;
  /** 最後の塊: 派生表を作り直し、確認（verify）を返す */
  finish: boolean;
  /** export が数えた、Cloudflare の表ごとの行数（count の突き合わせ） */
  expected?: Record<string, number>;
}

export interface ImportChunkResult extends ImportResult {
  /** finish のときだけ */
  verify?: {
    tables: Record<string, number>;
    problemCount: number;
    /** 先頭の 200 件 */
    problems: Problem[];
  };
}

/** HTTP で分けて送るときの 1 回分。Durable Object の `importRows` はこれを 1 トランザクションで呼べばよい */
export function importChunk(
  sql: Sql,
  rows: Iterable<ImportRow>,
  options: ImportChunkOptions,
): ImportChunkResult {
  if (options.begin) resetKeyless(sql);
  const result = importRows(sql, rows);
  if (!options.finish) return result;
  rebuildDerived(sql);
  const problems = verifySnapshot(sql, options.expected);
  return {
    ...result,
    verify: {
      tables: tableCounts(sql),
      problemCount: problems.length,
      problems: problems.slice(0, 200),
    },
  };
}
