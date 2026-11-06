import { DomainError } from "@mf100/domain";
import { FTS_TABLES, TABLES } from "./sqlite/schema.ts";
import { collabTables } from "./collab/store.ts";
import type { Sql } from "./sqlite/sql.ts";
import { upsertUser } from "./sqlite/users.ts";
import type { FnCtx } from "./functions/define.ts";
import { findFunction } from "./functions/index.ts";
import { adminSubjectsOf, loadUser, principalOf } from "./functions/principal.ts";
import { schedulerOf } from "./jobs.ts";
import { createSqliteContext } from "./sqlite/context.ts";
import type { Identity } from "./identity.ts";

/**
 * 関数の結果。DomainError は値で返す（Durable Object の RPC は Error の code・details を運ばない）。
 * reads は query だけ: 読んだ表の名前（購読者が「どの表が変わったら読み直すか」を知る単位）
 */
export type CallResult =
  | { ok: true; value: unknown; reads?: string[] }
  | { ok: false; code: string; details: Record<string, unknown> };

/** 関数を走らせる場所。Durable Object（本番）も Node の SQLite（テスト）も、これを満たせば同じ道を通る */
export interface Host {
  /** 追跡しない生の SQL */
  sql: Sql;
  env: Env;
  now: () => number;
  /** 外への HTTP（action が使う）。省略は global の fetch */
  fetch?: typeof fetch;
  /** throw で巻き戻る 1 トランザクション（DO は storage.transaction、テストは SAVEPOINT） */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

const WRITE = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(\w+)"?/i;
const READ = /\b(?:FROM|JOIN)\s+"?(\w+)"?/gi;

/**
 * 購読者に配らない表（書いても配らず、読んでも読みに数えない）。1 か所の値:
 * - jobs: あとで動く仕事の台帳（src/jobs.ts）。利用者の画面は読まない
 * - meta: 仕事の側の小さな状態（Slack の DM の枠）
 * - rateLimits: AI の利用の枠（src/rateLimit.ts）。残りを画面に出す読みは無い
 * - idempotency: 同じ requestId の再送の記録。mutation の中でしか引かない
 * - ruleEmbeddings: ルールの埋め込み。引くのは semanticRules:search（action）だけ
 * presence は 30 秒ごとの心拍で書くが、在席の一覧（presence:list）の購読者が読み直す表なので、ここには入れない
 */
export const SILENT_TABLES: ReadonlySet<string> = new Set([
  "jobs",
  "meta",
  "rateLimits",
  "idempotency",
  "ruleEmbeddings",
]);

const TABLE_NAMES: ReadonlySet<string> = new Set(
  [...TABLES.map((t) => t.name), ...FTS_TABLES, ...collabTables].filter(
    (name) => !SILENT_TABLES.has(name),
  ),
);

/**
 * 書いた表と読んだ表の名前を集める（SILENT_TABLES は数えない）。読みは `FROM <表>` / `JOIN <表>` を拾う（json_each(...) は表ではないので、
 * 名簿にある表の名前だけを数える。DELETE FROM の対象は書きであって読みではない）
 */
export function tracked(sql: Sql, touched: Set<string>, reads: Set<string> = new Set()): Sql {
  return {
    exec: (query, ...params) => {
      const write = WRITE.exec(query);
      if (write?.[1] && !SILENT_TABLES.has(write[1])) touched.add(write[1]);
      for (const m of query.slice(write ? write[0].length : 0).matchAll(READ))
        if (m[1] && TABLE_NAMES.has(m[1])) reads.add(m[1]);
      return sql.exec(query, ...params);
    },
  };
}

const fail = (code: string, details: Record<string, unknown> = {}): CallResult => ({
  ok: false,
  code,
  details,
});

/**
 * `POST /f/:name` の本体（Durable Object の call も、テストの偽物もここを呼ぶ）。
 * - 認可の最後の砦: HTTP の境界が確かめた結果（identity / serviceOk）を、関数の auth と突き合わせる
 * - query / action は transaction に包まない（query は書かない）。mutation は包み、DomainError は外へ出して巻き戻させる
 * - 本人の行（users）への反映は transaction の外・追跡の外: サインインは業務の書き込みではなく、巻き戻さず、購読者も起こさない
 */
export async function execute(
  host: Host,
  name: string,
  identity: Identity | null,
  args: unknown,
  serviceOk: boolean,
): Promise<{ result: CallResult; touched: Set<string> }> {
  const touched = new Set<string>();
  const reads = new Set<string>();
  const done = (result: CallResult) => ({ result, touched });

  const def = findFunction(name);
  // サービス専用が公開の口から来たら、存在ごと隠す（HTTP の境界と同じ 404）
  if (!def || (typeof def.auth === "object" && !serviceOk))
    return done(fail("function_not_found", { name }));
  const needsUser = def.auth === "user" || (typeof def.auth === "object" && def.auth.withUser);
  const wantsUser = needsUser || def.auth === "optional";
  if (needsUser && !identity) return done(fail("unauthenticated"));

  const user = wantsUser && identity ? loadUser(host.sql, upsertUser(host.sql, identity)) : null;

  const sql = tracked(host.sql, touched, reads);
  const adminSubjects = adminSubjectsOf(host.env);
  // 仕事の INSERT は追跡しない sql で行う（jobs は購読者に配らない）。transaction の中なので、巻き戻れば消える
  const schedule = schedulerOf(host);
  const run = async (): Promise<unknown> => {
    const db = createSqliteContext(sql, { clock: { now: host.now }, schedule });
    const ctx: FnCtx = {
      db,
      sql,
      principal: user ? await principalOf(db, user, adminSubjects) : null,
      userId: user?.id ?? null,
      env: host.env,
      now: host.now,
      // Workers の fetch は global から外すと Illegal invocation になるので、包んで渡す
      fetch: host.fetch ?? ((input, init) => fetch(input, init)),
      schedule,
    };
    return def.handler(ctx, args);
  };

  try {
    const value = def.kind === "mutation" ? await host.transaction(run) : await run();
    return done({
      ok: true,
      value: value ?? null,
      ...(def.kind === "query" ? { reads: [...reads].sort() } : {}),
    });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    // 巻き戻ったので、書いたはずの表は変わっていない（配らない）
    if (def.kind === "mutation") touched.clear();
    return done(fail(error.code, error.details));
  }
}

/** DomainError の code → HTTP の状態。Convex は ConvexError で運ぶが、HTTP では状態で分ける */
export function statusOf(code: string): 400 | 401 | 403 | 404 | 409 {
  if (code === "unauthenticated") return 401;
  if (code === "forbidden") return 403;
  if (code.endsWith("_not_found")) return 404;
  if (code.endsWith("_conflict")) return 409;
  return 400;
}
