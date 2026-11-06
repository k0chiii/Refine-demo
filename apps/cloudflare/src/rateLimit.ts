import type { Sql } from "./sqlite/sql.ts";

/*
 * 利用の上限。Convex の @convex-dev/rate-limiter（processing.ts と ai.ts の設定）の代わり。
 * 値は下の表が正本で、Convex の new RateLimiter(...) の引数と見比べて直せるようにしてある。
 * Slack の DM（1 秒に 1 件）は予約の形が違う（待ちを返して送る）ので、jobs.ts の reserveSlackDm が持つ。
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type Limit =
  /** rate 個 / period の速さで補充され、capacity まで貯まる。最初は満タン */
  | { kind: "token bucket"; rate: number; periodMs: number; capacity: number }
  /** period ごとに rate 個まで。窓が明けたら全部戻る */
  | { kind: "fixed window"; rate: number; periodMs: number };

export const RATE_LIMITS = {
  /** AI 校正（ai.ts）。使うのは U7b。key は利用者 ID */
  aiUser: { kind: "token bucket", rate: 6, periodMs: MINUTE, capacity: 2 },
  /** key は制作物 ID */
  aiWork: { kind: "token bucket", rate: 12, periodMs: MINUTE, capacity: 3 },
  /** 1 日に AI へ送れる文字数。key は利用者 ID、count は文字数 */
  aiCharacters: { kind: "fixed window", rate: 200_000, periodMs: DAY },
  /** ファイル処理（processing.ts）。key は利用者 ID */
  processingUser: { kind: "fixed window", rate: 20, periodMs: DAY },
  /** key は制作物 ID */
  processingWork: { kind: "fixed window", rate: 40, periodMs: DAY },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof RATE_LIMITS;

export type Verdict = { ok: true } | { ok: false; retryAfterMs: number };

/** 何度呼んでも同じ。schema.ts の migrate から呼ぶ（部品の表は業務の TABLES の外） */
export function migrateRateLimits(sql: Sql): void {
  sql.exec(
    `CREATE TABLE IF NOT EXISTS rateLimits (
       name TEXT NOT NULL, key TEXT NOT NULL, value REAL NOT NULL, ts INTEGER NOT NULL,
       PRIMARY KEY (name, key))`,
  );
}

interface State {
  value: number;
  ts: number;
}

/** 今の状態から、count 個取れるかと、取ったあとの状態。書くのは consume だけ */
function evaluate(
  limit: Limit,
  state: State | null,
  count: number,
  now: number,
): { verdict: Verdict; next: State } {
  const capacity = limit.kind === "token bucket" ? limit.capacity : limit.rate;
  // Convex も、満タンを超える要求は何を待っても通らないので投げる
  if (count > capacity) throw new Error(`rate limit: count ${count} exceeds capacity ${capacity}`);

  let value: number;
  let ts: number;
  if (limit.kind === "token bucket") {
    const prev = state ?? { value: capacity, ts: now };
    value = Math.min(capacity, prev.value + ((now - prev.ts) * limit.rate) / limit.periodMs);
    ts = now;
  } else {
    // ponytail: Convex は窓の始まりを乱数でずらす（同時に明けるのを避ける）。DO は 1 つなので、最初に使った時刻を窓の始まりにする
    const prev = state ?? { value: capacity, ts: now };
    const windows = Math.floor((now - prev.ts) / limit.periodMs);
    value = windows > 0 ? capacity : prev.value;
    ts = prev.ts + windows * limit.periodMs;
  }

  if (value >= count) return { verdict: { ok: true }, next: { value: value - count, ts } };
  const retryAfterMs =
    limit.kind === "token bucket"
      ? Math.ceil(((count - value) * limit.periodMs) / limit.rate)
      : ts + limit.periodMs - now;
  return { verdict: { ok: false, retryAfterMs }, next: { value, ts } };
}

function read(sql: Sql, name: LimitName, key: string): State | null {
  const [row] = sql.exec("SELECT value, ts FROM rateLimits WHERE name = ? AND key = ?", name, key);
  return row ? { value: row.value as number, ts: row.ts as number } : null;
}

/** 取れるかだけ見る（減らさない）。ai の「全部の枠を見てから、まとめて取る」に使う */
export function check(sql: Sql, name: LimitName, key: string, count: number, now: number): Verdict {
  return evaluate(RATE_LIMITS[name], read(sql, name, key), count, now).verdict;
}

/**
 * count 個取る。取れなければ何も減らさず、あと何 ms で取れるかを返す。
 * 呼び手の mutation が後で落ちれば、この書き込みも巻き戻る（Convex の rate-limiter と同じ）
 */
export function consume(
  sql: Sql,
  name: LimitName,
  key: string,
  count: number,
  now: number,
): Verdict {
  const { verdict, next } = evaluate(RATE_LIMITS[name], read(sql, name, key), count, now);
  // 取れなかったときは書かない（補充も窓の明けも、次に古い状態から同じ値を計算し直せる）
  if (verdict.ok)
    sql.exec(
      `INSERT INTO rateLimits (name, key, value, ts) VALUES (?, ?, ?, ?)
       ON CONFLICT (name, key) DO UPDATE SET value = excluded.value, ts = excluded.ts`,
      name,
      key,
      next.value,
      next.ts,
    );
  return verdict;
}
