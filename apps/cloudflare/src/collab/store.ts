import type { Sql } from "../sqlite/sql.ts";

/**
 * 在席（@convex-dev/presence）と共同編集（@convex-dev/prosemirror-sync）の表。
 * 業務の文書表（sqlite/schema.ts の TABLES）とは別に持つ: 部品の表は Convex でも本体の schema の外にあり、列で引くので生の列にする。
 * 表の名前は src/run.ts の `tracked` が「読んだ表」を拾うために知っておく必要がある。名簿は collabTables
 */
export const collabTables = [
  "presence",
  "presenceSessions",
  "collabSnapshots",
  "collabSteps",
  "collaborativeDrafts",
] as const;

/** 何度呼んでも同じ（IF NOT EXISTS だけ）。DO のコンストラクタから、migrate(sql) の後に呼ぶ */
export function migrateCollab(sql: Sql): void {
  for (const statement of [
    // 1 行 = 1 タブ。同じ人の複数タブは viewersOf で 1 人にまとめる
    `CREATE TABLE IF NOT EXISTS presence (
       roomId TEXT NOT NULL, userId TEXT NOT NULL, sessionId TEXT NOT NULL,
       lastSeenAt INTEGER NOT NULL, data TEXT,
       PRIMARY KEY (roomId, userId, sessionId))`,
    "CREATE INDEX IF NOT EXISTS ix_presence_lastSeenAt ON presence (lastSeenAt)",
    // 切断用の合言葉（そのタブだけを切れる。部屋の中の誰かを切る力は持たせない）
    `CREATE TABLE IF NOT EXISTS presenceSessions (
       sessionToken TEXT PRIMARY KEY, roomId TEXT NOT NULL, userId TEXT NOT NULL, sessionId TEXT NOT NULL)`,
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_presenceSessions_tab ON presenceSessions (roomId, userId, sessionId)",
    `CREATE TABLE IF NOT EXISTS collabSnapshots (
       docId TEXT NOT NULL, version INTEGER NOT NULL, content TEXT NOT NULL,
       PRIMARY KEY (docId, version))`,
    // 1 行 = 1 ステップ。version はそのステップを適用した後の版（最初のステップは snapshot の版 + 1）。
    // clientId は数も文字列も来る（vClientId）ので、型を付けずに入れたまま返す
    `CREATE TABLE IF NOT EXISTS collabSteps (
       docId TEXT NOT NULL, version INTEGER NOT NULL, step TEXT NOT NULL, clientId NOT NULL,
       PRIMARY KEY (docId, version))`,
    // Convex の collaborativeDrafts（workId, snapshotVersion）に、いつ誰が切り替えたかを添えたもの。docId は workId と同じ
    `CREATE TABLE IF NOT EXISTS collaborativeDrafts (
       workId TEXT PRIMARY KEY, snapshotVersion INTEGER NOT NULL, enabledAt INTEGER NOT NULL, enabledBy TEXT NOT NULL)`,
  ])
    sql.exec(statement);
}

// ---- 在席

/** 心拍の間隔（ms）。画面（WorkPresence）も 30 秒で送る */
export const PRESENCE_INTERVAL = 30_000;
/** 部品と同じ: 心拍が 2.5 回ぶん（= 75 秒）途切れたら切れたとみなす */
export const PRESENCE_TTL = PRESENCE_INTERVAL * 2.5;

/**
 * 切れたタブの行を消す。専用の掃除は持たず、心拍のついでに全部屋ぶん消す
 * ponytail: 誰も心拍を送らなければ残るが、viewersOf は期限で絞るので見えない。溜まるのは最後の人のぶんだけ
 */
export function sweepPresence(sql: Sql, now: number): void {
  const cutoff = now - PRESENCE_TTL;
  // 合言葉を先に消す（presence の行が無くなると、どのタブの合言葉か引けない）
  sql.exec(
    `DELETE FROM presenceSessions WHERE EXISTS (
       SELECT 1 FROM presence p
       WHERE p.roomId = presenceSessions.roomId AND p.userId = presenceSessions.userId
         AND p.sessionId = presenceSessions.sessionId AND p.lastSeenAt <= ?)`,
    cutoff,
  );
  sql.exec("DELETE FROM presence WHERE lastSeenAt <= ?", cutoff);
}

/** タブの心拍。行が無ければ作り、有れば時刻だけ更新して、同じ合言葉を返す */
export function beat(
  sql: Sql,
  tab: { roomId: string; userId: string; sessionId: string },
  now: number,
  newToken: () => string,
): string {
  const { roomId, userId, sessionId } = tab;
  sql.exec(
    `INSERT INTO presence (roomId, userId, sessionId, lastSeenAt) VALUES (?, ?, ?, ?)
     ON CONFLICT (roomId, userId, sessionId) DO UPDATE SET lastSeenAt = excluded.lastSeenAt`,
    roomId,
    userId,
    sessionId,
    now,
  );
  sql.exec(
    "INSERT OR IGNORE INTO presenceSessions (sessionToken, roomId, userId, sessionId) VALUES (?, ?, ?, ?)",
    newToken(),
    roomId,
    userId,
    sessionId,
  );
  const [row] = sql.exec(
    "SELECT sessionToken FROM presenceSessions WHERE roomId = ? AND userId = ? AND sessionId = ?",
    roomId,
    userId,
    sessionId,
  );
  return row!.sessionToken as string;
}

/** 合言葉のタブだけを切る。知らない合言葉は何もしない（Convex と同じ） */
export function leave(sql: Sql, sessionToken: string): void {
  const [tab] = sql.exec(
    "SELECT roomId, userId, sessionId FROM presenceSessions WHERE sessionToken = ?",
    sessionToken,
  );
  if (!tab) return;
  sql.exec(
    "DELETE FROM presence WHERE roomId = ? AND userId = ? AND sessionId = ?",
    tab.roomId as string,
    tab.userId as string,
    tab.sessionId as string,
  );
  sql.exec("DELETE FROM presenceSessions WHERE sessionToken = ?", sessionToken);
}

/** 部屋にいま居る人（期限内のタブがある人。入った順。複数タブは 1 人） */
export function viewersOf(sql: Sql, roomId: string, now: number, limit: number): string[] {
  return sql
    .exec(
      `SELECT userId FROM presence WHERE roomId = ? AND lastSeenAt > ?
       GROUP BY userId ORDER BY min(rowid) LIMIT ?`,
      roomId,
      now - PRESENCE_TTL,
      limit,
    )
    .map((r) => r.userId as string);
}

// ---- 共同編集（prosemirror-sync の component/lib.ts と同じ意味）

export type ClientId = string | number;

export function latestSnapshot(
  sql: Sql,
  docId: string,
  atMost = Number.MAX_SAFE_INTEGER,
): { content: string; version: number } | null {
  const [row] = sql.exec(
    "SELECT content, version FROM collabSnapshots WHERE docId = ? AND version <= ? ORDER BY version DESC LIMIT 1",
    docId,
    atMost,
  );
  return row ? { content: row.content as string, version: row.version as number } : null;
}

/** 最新の版。ステップがあればその版、無ければ snapshot の版、どちらも無ければ null */
export function latestVersion(sql: Sql, docId: string): number | null {
  const [step] = sql.exec("SELECT max(version) AS v FROM collabSteps WHERE docId = ?", docId);
  if (step?.v !== null && step?.v !== undefined) return step.v as number;
  return latestSnapshot(sql, docId)?.version ?? null;
}

/** 同じ版に同じ中身なら何もしない（冪等）。違う中身が既にあれば false（呼び手が競合として扱う） */
export function putSnapshot(sql: Sql, docId: string, version: number, content: string): boolean {
  const [existing] = sql.exec(
    "SELECT content FROM collabSnapshots WHERE docId = ? AND version = ?",
    docId,
    version,
  );
  if (existing) return existing.content === content;
  sql.exec(
    "INSERT INTO collabSnapshots (docId, version, content) VALUES (?, ?, ?)",
    docId,
    version,
    content,
  );
  return true;
}

/**
 * `afterVersion` より後のステップ（版の昇順）。
 * ponytail: 件数の上限は設けない（部品は 100 件で切る）。画面は自分の版から追うので、普段は数件
 */
export function stepsAfter(
  sql: Sql,
  docId: string,
  afterVersion: number,
): { steps: string[]; clientIds: ClientId[] } {
  const rows = sql.exec(
    "SELECT version, step, clientId FROM collabSteps WHERE docId = ? AND version > ? ORDER BY version",
    docId,
    afterVersion,
  );
  // 版が 1 つずつ続いていなければ途中が欠けている（部品も "Missing steps" で落とす）
  if (rows[0] && (rows[0].version as number) !== afterVersion + 1)
    throw new Error(`Missing steps ${afterVersion + 1}...${(rows[0].version as number) - 1}`);
  return {
    steps: rows.map((r) => r.step as string),
    clientIds: rows.map((r) => r.clientId as ClientId),
  };
}

export function appendSteps(
  sql: Sql,
  docId: string,
  fromVersion: number,
  clientId: ClientId,
  steps: readonly string[],
): void {
  steps.forEach((step, i) => {
    sql.exec(
      "INSERT INTO collabSteps (docId, version, step, clientId) VALUES (?, ?, ?, ?)",
      docId,
      fromVersion + i + 1,
      step,
      clientId,
    );
  });
}

// ---- 共同編集に切り替えた下書き

export function collaborativeDraft(sql: Sql, workId: string): { snapshotVersion: number } | null {
  const [row] = sql.exec(
    "SELECT snapshotVersion FROM collaborativeDrafts WHERE workId = ?",
    workId,
  );
  return row ? { snapshotVersion: row.snapshotVersion as number } : null;
}

export function enableDraft(sql: Sql, workId: string, at: number, by: string): void {
  sql.exec(
    "INSERT INTO collaborativeDrafts (workId, snapshotVersion, enabledAt, enabledBy) VALUES (?, 1, ?, ?)",
    workId,
    at,
    by,
  );
}

export function advanceSnapshotVersion(sql: Sql, workId: string, version: number): void {
  sql.exec("UPDATE collaborativeDrafts SET snapshotVersion = ? WHERE workId = ?", version, workId);
}
