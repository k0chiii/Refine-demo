import { DurableObject } from "cloudflare:workers";
import {
  closeExpiredReviews,
  expireCommentFiles,
  expireUploadSessions,
  remindUpcomingDeadlines,
} from "@mf100/application";
import type { Identity } from "./identity.ts";
import { createJobContext, nextJobAt, runDueJobs } from "./jobs.ts";
import { execute, tracked, type CallResult, type Host } from "./run.ts";
import { migrate } from "./sqlite/schema.ts";
import { createAuthStore, migrateAuth, type AuthStore } from "./auth/store.ts";
import { migrateCollab } from "./collab/store.ts";
import { expireAiJobs } from "./functions/aiWorkflow.ts";
import { expireProcessingJobs } from "./functions/processing.ts";
import type { Sql } from "./sqlite/sql.ts";

/** Durable Object の SqlStorage を application のアダプタが使う最小の口に合わせる */
function durableSql(storage: SqlStorage): Sql {
  return {
    exec: (query, ...params) =>
      storage.exec(query, ...params).toArray() as Record<string, unknown>[],
  };
}

/**
 * 業務データの正本。Convex の「DB + mutation の直列化 + 購読」をこの 1 つの Durable Object が担う。
 * - call: 関数を名前で 1 回走らせる（src/run.ts の execute）。mutation は 1 トランザクション（storage.transaction）で、
 *   途中で投げたら何も残らない。入力ゲートがあるので同時に走る呼び出しは無く、Convex の mutation と同じ直列化になる。
 *   query は読んだ表の名前を返す
 * - WebSocket: 書き込みのあと、書いたテーブル名を配る。受け手は関係する読み直しをする
 * - alarm: あとで動く仕事（src/jobs.ts の jobs 表）。外への通知の配信・やり直しもここ
 * ponytail: DO 1 つ = 書き込みが全体で直列。足りなくなったら年度や制作物で分ける
 */
export class MF100Database extends DurableObject<Env> {
  private readonly sql: Sql;
  private readonly authStore: AuthStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = durableSql(ctx.storage.sql);
    // users の表ができてから、その上の subject の index（migrateAuth）。順番を入れ替えると落ちる
    migrate(this.sql);
    migrateAuth(this.sql);
    migrateCollab(this.sql);
    this.authStore = createAuthStore(this.sql);
  }

  /** 認証の保存（セッション・一時コード・state）。Hono 側は src/index.ts の authStoreOf で AuthStore の形に戻す */
  async auth<K extends keyof AuthStore>(
    op: K,
    ...args: Parameters<AuthStore[K]>
  ): Promise<Awaited<ReturnType<AuthStore[K]>>> {
    const fn = this.authStore[op] as (...a: unknown[]) => Promise<unknown>;
    return (await fn.call(this.authStore, ...args)) as Awaited<ReturnType<AuthStore[K]>>;
  }

  private get host(): Host {
    return {
      sql: this.sql,
      env: this.env,
      now: () => Date.now(),
      // DomainError も transaction の外へ出す。そうしないと途中までの書き込みが commit される
      transaction: (fn) => this.ctx.storage.transaction(fn),
    };
  }

  async call(
    name: string,
    identity: Identity | null,
    args: unknown,
    serviceOk: boolean,
  ): Promise<CallResult> {
    const { result, touched } = await execute(this.host, name, identity, args, serviceOk);
    this.notify(touched);
    // query は書かない。mutation が仕事を積んだかもしれないので、alarm を立て直す（巻き戻っていれば何も増えていない）
    if (!(result.ok && result.reads)) await this.armAlarm(nextJobAt(this.sql));
    return result;
  }

  /**
   * cron（毎分）。Convex の crons.ts の配分: 受付終了は毎分、残りは毎時。あとで動く仕事の取りこぼしも毎分拾う。
   * processing.expire は毎時、aiWorkflow.expire（AI の一時結果の期限切れ）は 5 分ごと
   */
  async runJobs(at: Date): Promise<void> {
    const touched = new Set<string>();
    const ctx = createJobContext(
      { sql: this.sql, env: this.env, now: () => at.getTime() },
      tracked(this.sql, touched),
    );
    await this.ctx.storage.transaction(async () => {
      await closeExpiredReviews(ctx);
      if (at.getUTCMinutes() % 5 === 0) expireAiJobs(tracked(this.sql, touched), at.getTime());
      if (at.getUTCMinutes() !== 0) return;
      await remindUpcomingDeadlines(ctx);
      await expireUploadSessions(ctx);
      await expireCommentFiles(ctx);
      expireProcessingJobs(tracked(this.sql, touched), at.getTime());
    });
    this.notify(touched);
    // alarm が落ちていても、毎分ここで拾う
    await this.drainJobs();
  }

  /** alarm: 期限の来た仕事を動かし、残りがあれば次の alarm を立てる */
  override async alarm(): Promise<void> {
    await this.drainJobs();
  }

  /**
   * 仕事を動かす。alarm と cron が重なると同じ仕事を二重に送るので、動いている間は後から来たものは何もしない
   * （残りは今動いているものが拾い、最後に次の alarm を立てる）
   */
  private draining = false;
  private async drainJobs(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const { nextRunAt, touched } = await runDueJobs(
        this.host,
        { fetch: (input, init) => fetch(input, init) },
        Date.now(),
      );
      this.notify(touched);
      await this.armAlarm(nextRunAt);
    } finally {
      this.draining = false;
    }
  }

  /** 次の仕事の時刻に alarm を立てる（過ぎていれば今）。仕事が無ければ立てない */
  private async armAlarm(nextRunAt: number | null): Promise<void> {
    if (nextRunAt !== null) await this.ctx.storage.setAlarm(Math.max(nextRunAt, Date.now()));
  }

  /** WebSocket の受け付け（休止 API。接続中は DO が寝ても切れない） */
  override async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** 書いた表があれば、その名前を全部の接続へ（巻き戻った呼び出しの分は execute が空にしてある） */
  private notify(touched: Set<string>): void {
    if (touched.size === 0) return;
    const text = JSON.stringify({ changed: [...touched] });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // 閉じかけの接続。次の getWebSockets() には出ない
      }
    }
  }
}
