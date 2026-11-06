import { createApp } from "../app.ts";
import { devIdentifier } from "../identity.ts";
import { execute, type Host } from "../run.ts";
import { createSqliteContext } from "../sqlite/context.ts";
import { migrate } from "../sqlite/schema.ts";
import type { Sql } from "../sqlite/sql.ts";
import { nodeSql } from "./context.ts";

// app.test.ts と functions.test.ts が共有する、Durable Object の代わりの Node 上の App

export const UPLOAD_SECRET = "upload-secret-0123456789";

/**
 * Durable Object の代わり: 同じ SQLite のアダプタ・同じ execute を Node の中で直に包む。
 * 1 呼び出し = 1 トランザクションは SAVEPOINT で真似る（DO では storage.transaction）。
 * `wrap` で SQL に故障を仕込める（途中で落ちたときの巻き戻しを確かめる）
 */
export function fakeDb(wrap: (sql: Sql) => Sql = (s) => s, env: Record<string, string> = {}) {
  const raw = nodeSql();
  migrate(raw);
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
  return {
    clock,
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
    fetch: async () => new Response(null, { status: 101 }),
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
