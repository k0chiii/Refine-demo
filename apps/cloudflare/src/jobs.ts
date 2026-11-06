import {
  markUnreadNotificationsRead,
  syncPlanInfoWarnings,
  type AppContext,
} from "@mf100/application";
import {
  ACCOUNT_CHANNELS,
  type ChannelAvailability,
  DomainError,
  normalizeNotificationPrefs,
  reachableChannels,
} from "@mf100/domain";
import { availableChannels, deliveryConfigFromEnv } from "./delivery/channels.ts";
import {
  type DeliveryIo,
  deliverNotification,
  nextRetryDelayMs,
  resolveSlackForUser,
} from "./delivery/deliver.ts";
import { executeAiJob } from "./functions/aiWorkflow.ts";
import { adminSubjectsOf, loadUser, principalOf } from "./functions/principal.ts";
import { indexRule } from "./functions/semanticRules.ts";
import { type Host, tracked } from "./run.ts";
import { createSqliteContext } from "./sqlite/context.ts";
import { randomId } from "./sqlite/docs.ts";
import type { Sql } from "./sqlite/sql.ts";

/*
 * あとで動く仕事。Convex の scheduler.runAfter / workpool に当たる。
 * 積むのはユースケースと同じトランザクションの中（巻き戻れば仕事も消える。Convex の scheduler と同じ性質）。
 * 動かすのは Durable Object の alarm（src/db.ts）で、cron も毎分 1 回拾う（alarm が落ちても止まらない）。
 * ponytail: feedbackMigration（Convex の手動起動の移行）は関数をまだ移していないので kind を持たない
 */

/** 仕事の種類と、その引数（Convex の internal.* の args と同じ） */
export type Job =
  | { kind: "deliver"; notificationId: string }
  | { kind: "resolveSlack"; userId: string }
  | { kind: "planInfoSync"; workId: string; userId: string }
  | { kind: "continueMarkAllRead"; recipientId: string; asOf: number }
  | { kind: "indexRule"; ruleId: string }
  | { kind: "aiProofread"; jobId: string };

/** jobs 表の doc。payload は kind を除いた引数 */
interface JobDoc {
  kind: Job["kind"];
  payload: Record<string, unknown>;
  runAt: number;
  attempts: number;
  lastError?: string;
  createdAt: number;
}

/**
 * 仕事を積む。runAt は実行してよい時刻（ms）。
 * deliver は通知ごとに 1 件（同じ通知を二度積んでも 1 件のまま）
 */
export function enqueueJob(sql: Sql, job: Job, runAt: number, createdAt: number = runAt): void {
  const { kind, ...payload } = job;
  const doc: JobDoc = { kind, payload, runAt, attempts: 0, createdAt };
  const id = job.kind === "deliver" ? `deliver|${job.notificationId}` : randomId("jobs");
  sql.exec("INSERT OR IGNORE INTO jobs (id, doc) VALUES (?, ?)", id, JSON.stringify(doc));
}

/**
 * 通知の受信者に外への届け先があるか（通知の種類によらない。止めた分類は送る時点の計画が落とす）。
 * Convex の adapters の hasReachableChannel と同じ。届け先の無い人の分まで仕事を積まない
 */
function hasReachableChannel(
  sql: Sql,
  notificationId: string,
  available: ChannelAvailability,
): boolean {
  const [n] = sql.exec(
    "SELECT json_extract(doc, '$.recipientId') AS userId FROM notifications WHERE id = ?",
    notificationId,
  );
  if (typeof n?.userId !== "string") return false;
  const [prefs] = ACCOUNT_CHANNELS.some((c) => available.has(c))
    ? sql.exec("SELECT doc FROM notificationPrefs WHERE id = ?", n.userId)
    : [];
  const hasPushDevice =
    available.has("push") &&
    sql.exec("SELECT 1 FROM pushSubscriptions WHERE userId = ? LIMIT 1", n.userId).length > 0;
  return (
    reachableChannels({
      prefs: normalizeNotificationPrefs(prefs ? JSON.parse(prefs.doc as string) : null),
      available,
      hasPushDevice,
    }).length > 0
  );
}

/**
 * `schedule` の本体（FnCtx と createSqliteContext に渡す）。使えない経路・無効な機能の仕事は積まない
 * （Convex の adapters が scheduler を呼ぶ前に見ているのと同じ条件）。
 * sql は追跡しない生のもの: jobs は購読者に配らない
 */
export function schedulerOf(host: Pick<Host, "sql" | "env" | "now">): (job: Job) => void {
  return (job) => {
    const config = deliveryConfigFromEnv(host.env);
    if (job.kind === "deliver") {
      const available = availableChannels(config);
      if (available.size === 0 || !hasReachableChannel(host.sql, job.notificationId, available))
        return;
    }
    if (job.kind === "resolveSlack" && !config.slack) return;
    if (job.kind === "indexRule" && host.env.RULE_EMBEDDINGS_ENABLED !== "true") return;
    enqueueJob(host.sql, job, host.now());
  };
}

/** 仕事を積める application のコンテキスト（関数の実行・cron・alarm の仕事が同じ作り方をする） */
export function createJobContext(host: Pick<Host, "sql" | "env" | "now">, sql: Sql): AppContext {
  return createSqliteContext(sql, { clock: { now: host.now }, schedule: schedulerOf(host) });
}

/** 残りの仕事のうち最も早い runAt。無ければ null（alarm を立てる材料） */
export function nextJobAt(sql: Sql): number | null {
  const [row] = sql.exec("SELECT min(runAt) AS next FROM jobs");
  return typeof row?.next === "number" ? row.next : null;
}

/** DM の枠（めいちゃんの制限: 1 秒に 1 件）。Convex の rate-limiter の fixed window（rate 1・period 1000・reserve）の代わり */
const SLACK_DM_PERIOD_MS = 1000;

/**
 * 次の DM を送ってよい時刻を予約して、そこまでの待ちを返す。
 * ponytail: DO は 1 つなので、前回の予約の時刻を 1 行（meta）に持つだけ。予約は追跡しない生の sql で書く
 */
export function reserveSlackDm(sql: Sql, now: number): { ok: boolean; retryAfter: number } {
  const [row] = sql.exec(
    "SELECT json_extract(doc, '$.nextAt') AS nextAt FROM meta WHERE id = ?",
    "slackDm",
  );
  const start = Math.max(now, typeof row?.nextAt === "number" ? row.nextAt : 0);
  sql.exec(
    "INSERT INTO meta (id, doc) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET doc = excluded.doc",
    "slackDm",
    JSON.stringify({ nextAt: start + SLACK_DM_PERIOD_MS }),
  );
  return { ok: true, retryAfter: start - now };
}

/** alarm の 1 回で動かす仕事の上限。残りは次の alarm へ（1 回の alarm を長く占めない） */
const RUN_LIMIT = 20;

/**
 * kind ごとの「同時に動かす数」。無い kind は 1 件ずつ。
 * aiProofread は Convex の workflow（maxParallelism: 2）と同じ 2。外への長い fetch を待つ間に次を始める
 * ponytail: 同時に動かすのは、古い順に拾った先頭の kind の分だけ（別の kind とは混ぜない）。数が増えたら待ち行列にする
 */
const PARALLELISM: Partial<Record<Job["kind"], number>> = { aiProofread: 2 };

/** 外の世界（テストは偽の fetch・sleep を渡す） */
export type JobIo = Pick<DeliveryIo, "fetch" | "sleep">;

type Outcome = { retry: false } | { retry: true; retryAfterMs?: number; error?: string };
const DONE: Outcome = { retry: false };

/**
 * 期限の来た仕事を古い順に動かす（最大 RUN_LIMIT 件）。1 件ずつ。ただし PARALLELISM のある kind は、先頭の 1 件に続く
 * 同じ kind の期限の来たものを上限まで同時に動かす。
 * - 成功: 消す。retry: attempts を数え、runAt = now + max(待ち, retryAfterMs)。待ちは配信の方針（DELIVERY_RETRY）に従い、使い切ったらあきらめて消す
 * - 例外は retry 扱い。ただし DomainError は何度やっても同じなので、あきらめて消す（Convex でも scheduler は ConvexError を再実行しない）
 * 戻りの nextRunAt は残りの仕事の最小の runAt（無ければ null）、touched は仕事が書いた表（購読者に配る分）
 */
export async function runDueJobs(
  host: Host,
  io: JobIo,
  now: number,
  limit: number = RUN_LIMIT,
): Promise<{ nextRunAt: number | null; touched: Set<string> }> {
  const touched = new Set<string>();
  for (let n = 0; n < limit;) {
    const [first] = host.sql.exec(
      "SELECT id, doc FROM jobs WHERE runAt <= ? ORDER BY runAt, rowid LIMIT 1",
      now,
    );
    if (!first) break;
    const kind = (JSON.parse(first.doc as string) as JobDoc).kind;
    const parallel = Math.min(PARALLELISM[kind] ?? 1, limit - n);
    const batch = [first];
    if (parallel > 1)
      batch.push(
        ...host.sql.exec(
          "SELECT id, doc FROM jobs WHERE runAt <= ? AND kind = ? AND id != ? ORDER BY runAt, rowid LIMIT ?",
          now,
          kind,
          first.id as string,
          parallel - 1,
        ),
      );
    await Promise.all(batch.map((row) => settle(host, io, now, row, touched)));
    n += batch.length;
  }
  return { nextRunAt: nextJobAt(host.sql), touched };
}

/** 1 件を動かして、結果（消す・やり直し・あきらめる）を jobs 表に書く */
async function settle(
  host: Host,
  io: JobIo,
  now: number,
  row: Record<string, unknown>,
  touched: Set<string>,
): Promise<void> {
  const id = row.id as string;
  const doc = JSON.parse(row.doc as string) as JobDoc;
  const job = { kind: doc.kind, ...doc.payload } as Job;

  let outcome: Outcome;
  try {
    outcome = await runJob(host, io, now, job, touched);
  } catch (error) {
    if (error instanceof DomainError) {
      console.warn(JSON.stringify({ event: "job_failed", kind: doc.kind, id, code: error.code }));
      outcome = DONE;
    } else {
      outcome = { retry: true, error: error instanceof Error ? error.name : "error" };
    }
  }

  if (!outcome.retry) {
    host.sql.exec("DELETE FROM jobs WHERE id = ?", id);
    return;
  }
  const attempts = doc.attempts + 1;
  const wait = nextRetryDelayMs(attempts);
  if (wait === null) {
    console.warn(JSON.stringify({ event: "job_gave_up", kind: doc.kind, id, attempts }));
    host.sql.exec("DELETE FROM jobs WHERE id = ?", id);
    return;
  }
  host.sql.exec(
    "UPDATE jobs SET doc = ? WHERE id = ?",
    JSON.stringify({
      ...doc,
      attempts,
      runAt: now + Math.max(wait, outcome.retryAfterMs ?? 0),
      lastError: outcome.error ?? "retry",
    } satisfies JobDoc),
    id,
  );
}

async function runJob(
  host: Host,
  io: JobIo,
  now: number,
  job: Job,
  touched: Set<string>,
): Promise<Outcome> {
  const ctx = () => createJobContext(host, tracked(host.sql, touched));
  switch (job.kind) {
    case "deliver": {
      // 送るのは外への fetch をまたぐので、transaction で包まない。決着の記録は 1 文ずつで、何度呼んでも二重に送らない
      const result = await deliverNotification(ctx(), job.notificationId, host.env, {
        ...io,
        now: () => now,
        reserveSlackDm: async () => reserveSlackDm(host.sql, now),
      });
      if (!result.retry) return DONE;
      return result.retryAfterMs === undefined
        ? { retry: true }
        : { retry: true, retryAfterMs: result.retryAfterMs };
    }
    case "resolveSlack":
      // 引けなければ未確認のまま（次に送るときに引く）。やり直しは積まない
      await resolveSlackForUser(ctx(), job.userId, host.env, io);
      return DONE;
    case "planInfoSync":
      await host.transaction(async () => {
        const [user] = host.sql.exec("SELECT id FROM users WHERE id = ?", job.userId);
        if (!user) return;
        const db = ctx();
        const principal = await principalOf(
          db,
          loadUser(host.sql, job.userId),
          adminSubjectsOf(host.env),
        );
        await syncPlanInfoWarnings(db, principal, job.workId);
      });
      return DONE;
    case "continueMarkAllRead":
      // 続きがあれば、同じトランザクションで次の 1 回分を積む
      await host.transaction(async () => {
        const db = ctx();
        const r = await markUnreadNotificationsRead(db, job.recipientId, job.asOf);
        if (r.hasMore) schedulerOf(host)(job);
      });
      return DONE;
    case "indexRule":
      // 送るのは外への fetch をまたぐので transaction で包まない。書くのは最後の 1 文。通信の失敗は例外で retry になる
      await indexRule(
        {
          db: ctx(),
          sql: tracked(host.sql, touched),
          env: host.env,
          now: () => now,
          fetch: io.fetch,
        },
        job.ruleId,
      );
      return DONE;
    case "aiProofread":
      // 失敗は aiJobs の行に書いて完了で返る（Convex の step は retry: false）。外へ送る間は transaction の外
      await executeAiJob(
        {
          db: ctx(),
          sql: tracked(host.sql, touched),
          env: host.env,
          now: host.now,
          fetch: io.fetch,
        },
        job.jobId,
      );
      return DONE;
  }
}
