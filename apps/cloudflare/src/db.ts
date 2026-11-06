import { DurableObject } from "cloudflare:workers";
import {
  closeExpiredReviews,
  expireCommentFiles,
  expireUploadSessions,
  remindUpcomingDeadlines,
} from "@mf100/application";
import type { Identity } from "./identity.ts";
import { runUsecase, type RunResult } from "./run.ts";
import { createSqliteContext } from "./sqlite/context.ts";
import { migrate } from "./sqlite/schema.ts";
import type { Sql } from "./sqlite/sql.ts";
import { upsertUser } from "./sqlite/users.ts";
import type { UsecaseName } from "./registry.ts";

/** Durable Object の SqlStorage を application のアダプタが使う最小の口に合わせる */
function durableSql(storage: SqlStorage): Sql {
  return {
    exec: (query, ...params) =>
      storage.exec(query, ...params).toArray() as Record<string, unknown>[],
  };
}

/** 書いたテーブルの名前を集める（購読者へ「何が変わったか」を知らせる単位） */
function tracked(sql: Sql, touched: Set<string>): Sql {
  const write = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(\w+)"?/i;
  return {
    exec: (query, ...params) => {
      const m = write.exec(query);
      if (m?.[1]) touched.add(m[1]);
      return sql.exec(query, ...params);
    },
  };
}

/**
 * 業務データの正本。Convex の「DB + mutation の直列化 + 購読」をこの 1 つの Durable Object が担う。
 * - run: 1 呼び出し = 1 トランザクション。途中で投げたら何も残らない（storage.transaction）。
 *   入力ゲートがあるので同時に走る呼び出しは無く、Convex の mutation と同じ直列化になる
 * - WebSocket: 書き込みのあと、書いたテーブル名を配る。受け手は関係する読み直しをする
 * ponytail: DO 1 つ = 書き込みが全体で直列。足りなくなったら年度や制作物で分ける
 */
export class MF100Database extends DurableObject<Env> {
  private readonly sql: Sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = durableSql(ctx.storage.sql);
    migrate(this.sql);
  }

  async run(identity: Identity, name: UsecaseName, args: unknown[]): Promise<RunResult> {
    const touched = new Set<string>();
    const sql = tracked(this.sql, touched);
    const ctx = createSqliteContext(sql, { clock: { now: () => Date.now() } });
    const deps = {
      adminSubjects: new Set(
        (this.env.MF100_SYSTEM_ADMIN_SUBJECTS ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
      upsertUser: async (who: Identity) => upsertUser(sql, who),
    };
    const result = await this.ctx.storage.transaction(() =>
      runUsecase(ctx, identity, name, args, deps),
    );
    // DomainError で終わった呼び出しも transaction は commit する（throw していない）。読み直しの合図は書いたときだけ
    if (result.ok && touched.size > 0) this.broadcast({ changed: [...touched] });
    return result;
  }

  /** cron（毎分）。Convex の crons.ts の配分: 受付終了は毎分、残りは毎時 */
  async runJobs(at: Date): Promise<void> {
    const ctx = createSqliteContext(this.sql, { clock: { now: () => at.getTime() } });
    await this.ctx.storage.transaction(async () => {
      await closeExpiredReviews(ctx);
      if (at.getUTCMinutes() !== 0) return;
      await remindUpcomingDeadlines(ctx);
      await expireUploadSessions(ctx);
      await expireCommentFiles(ctx);
    });
    this.broadcast({ changed: ["revisions", "notifications", "uploadSessions", "commentFiles"] });
  }

  /** WebSocket の受け付け（休止 API。接続中は DO が寝ても切れない） */
  override async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private broadcast(message: { changed: string[] }): void {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // 閉じかけの接続。次の getWebSockets() には出ない
      }
    }
  }
}
