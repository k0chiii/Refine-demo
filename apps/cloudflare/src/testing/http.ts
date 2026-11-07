import { expect } from "vite-plus/test";
import { createApp } from "../app.ts";
import { devIdentifier } from "../identity.ts";
import { type JobIo, nextJobAt, runDueJobs } from "../jobs.ts";
import { execute, type Host } from "../run.ts";
import { createSqliteContext } from "../sqlite/context.ts";
import { migrate } from "../sqlite/schema.ts";
import type { Sql } from "../sqlite/sql.ts";
import { nodeSql } from "./context.ts";
import { migrateCollab } from "../collab/store.ts";
import { importChunk, type ImportChunkOptions, type ImportRow } from "../migrate/import.ts";

// app.test.ts と functions.test.ts が共有する、Durable Object の代わりの Node 上の App

/** jobs 表の 1 行の中身（src/jobs.ts の JobDoc） */
interface JobDoc {
  kind: string;
  payload: Record<string, unknown>;
  runAt: number;
  attempts: number;
  lastError?: string;
  createdAt: number;
}

export const UPLOAD_SECRET = "upload-secret-0123456789";

/**
 * Durable Object の代わり: 同じ SQLite のアダプタ・同じ execute を Node の中で直に包む。
 * 1 呼び出し = 1 トランザクションは SAVEPOINT で真似る（DO では storage.transaction）。
 * `wrap` で SQL に故障を仕込める（途中で落ちたときの巻き戻しを確かめる）
 */
export function fakeDb(wrap: (sql: Sql) => Sql = (s) => s, env: Record<string, string> = {}) {
  const raw = nodeSql();
  migrate(raw);
  migrateCollab(raw);
  const sql = wrap(raw);
  /** テストが進める時計（期限・「今」を使う読みを確かめる）。既定は 2026-11-01 */
  const clock = { current: Date.UTC(2026, 10, 1) };
  const host: Host = {
    sql,
    env: { MF100_SYSTEM_ADMIN_SUBJECTS: "", ...env } as Env,
    now: () => clock.current,
    transaction: async (fn) => {
      raw.exec("SAVEPOINT call");
      try {
        const value = await fn();
        raw.exec("RELEASE call");
        return value;
      } catch (e) {
        raw.exec("ROLLBACK TO call");
        raw.exec("RELEASE call");
        throw e;
      }
    },
  };
  const notified: string[][] = [];
  /** WebSocket の受け付け（fetch）に届いた Request */
  const upgrades: Request[] = [];
  return {
    clock,
    host,
    /** あとで動く仕事（jobs 表）を古い順に覗く */
    jobs: () =>
      raw
        .exec("SELECT id, doc FROM jobs ORDER BY runAt, rowid")
        .map((r) => ({ id: r.id as string, ...(JSON.parse(r.doc as string) as JobDoc) })),
    /** alarm の代わり: 期限の来た仕事を、時計の「今」で動かす */
    runDue: (io: JobIo, limit?: number) => runDueJobs(host, io, clock.current, limit),
    nextJobAt: () => nextJobAt(raw),
    upgrades,
    /** 派生表を直に覗く・壊す用（追跡も巻き戻しも通さない） */
    sql: raw,
    /** テストが結果を覗く用（アプリを通さない） */
    db: createSqliteContext(raw, { clock: { now: host.now } }),
    notified,
    call: async (
      name: string,
      identity: Parameters<typeof execute>[2],
      args: unknown,
      ok: boolean,
    ) => {
      const { result, touched } = await execute(host, name, identity, args, ok);
      notified.push([...touched].sort());
      return result;
    },
    /** DO の importRows の代わり（1 トランザクションは SAVEPOINT で真似る） */
    importRows: async (rows: ImportRow[], options: ImportChunkOptions) => {
      raw.exec("SAVEPOINT import");
      try {
        const result = importChunk(raw, rows, options);
        raw.exec("RELEASE import");
        return result;
      } catch (e) {
        raw.exec("ROLLBACK TO import");
        raw.exec("RELEASE import");
        throw e;
      }
    },
    fetch: async (request: Request) => {
      upgrades.push(request);
      // Node の Response は 101 を作れない。DO は 101 で返すが、ここでは「受け付けた」印に 200 を返す
      return new Response("upgraded");
    },
  };
}

export function app(
  db = fakeDb(),
  secrets: Record<string, string> = { MF100_UPLOAD_SECRET: UPLOAD_SECRET },
) {
  return createApp({
    identify: devIdentifier,
    db: () => db,
    secret: (name) => secrets[name],
    allowedOrigins: [],
    // 認証の経路はこのテストでは使わない（src/auth.test.ts が持つ）。形だけ満たす
    auth: { store: () => ({}) as never, env: {} },
  });
}

export const as = (subject: string) => ({
  "X-MF100-Identity": JSON.stringify({ subject, name: subject }),
  "Content-Type": "application/json",
});
export const post = (
  a: ReturnType<typeof app>,
  name: string,
  args: unknown,
  subject: string | null = "u_manager",
  headers: Record<string, string> = {},
) =>
  a.request(`/f/${name}`, {
    method: "POST",
    headers: { ...(subject ? as(subject) : { "Content-Type": "application/json" }), ...headers },
    body: JSON.stringify(args),
  });

/** サインインして利用者 ID を得る（users.id は払い出し値なので、subject からは決まらない） */
export async function signIn(a: ReturnType<typeof app>, subject: string): Promise<string> {
  const res = await post(a, "me:me", {}, subject);
  return ((await res.json()) as { value: { id: string } }).value.id;
}

/** 戻りの形は Convex と同じかを見るテストなので、型は付けずに値だけ引く */
// oxlint-disable-next-line typescript/no-explicit-any
type Json = any;

/** 関数を呼んで 200 を確かめ、`{ value }` の value を返す。外れたときは body を見せる */
export async function callFn(
  a: ReturnType<typeof app>,
  name: string,
  args: unknown,
  subject: string | null,
  headers: Record<string, string> = {},
): Promise<Json> {
  const res = await post(a, name, args, subject, headers);
  const body = (await res.json()) as { value?: unknown };
  expect(res.status, `${name}: ${JSON.stringify(body)}`).toBe(200);
  return body.value;
}

/** 関数を呼んで、断られたときの status と code を返す */
export async function failFn(
  a: ReturnType<typeof app>,
  name: string,
  args: unknown,
  subject: string | null,
  headers: Record<string, string> = {},
) {
  const res = await post(a, name, args, subject, headers);
  return { status: res.status, ...((await res.json()) as { code: string }) };
}
