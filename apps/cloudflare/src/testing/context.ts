import type {
  ApprovalConfirmation,
  Artifact,
  CommentEvent,
  CommentFile,
  CommentThread,
  FeedbackFile,
  FeedbackPost,
  FeedbackThread,
  RequiredCheck,
  UploadAttempt,
  Work,
  WorkPermissionGrant,
} from "@mf100/domain";
import { principals } from "@mf100/application/testing";
import type {
  AppContext,
  AuditEntry,
  Notification,
  PushSubscriptionRecord,
} from "@mf100/application";
import { DatabaseSync } from "node:sqlite";
import { Docs, Rows } from "../sqlite/docs.ts";
import { createSqliteContext } from "../sqlite/context.ts";
import { migrate } from "../sqlite/schema.ts";
import type { Sql } from "../sqlite/sql.ts";

/** 時計だけテストが進める（ctx.clock.advance / current）。 */
export class FakeClock {
  constructor(public current: number) {}
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

/**
 * application のテストが `../testing/inMemory.ts` から受け取っていたもの（vite.config.ts の alias でここへ向ける）。
 * 中身は SQLite（メモリ上の node:sqlite）。テストは ctx.state を覗くので、必要な分だけ SQL へ流す薄い view を添える。
 */
type View<T extends { id: string }> = Pick<Docs<T>, "all" | "get" | "put" | "insert">;

export interface InMemoryContext extends AppContext {
  clock: FakeClock;
  state: {
    works: View<Work>;
    artifacts: View<Artifact>;
    threads: View<CommentThread>;
    confirmations: View<ApprovalConfirmation>;
    checks: View<RequiredCheck>;
    notifications: View<Notification>;
    pushSubscriptions: View<PushSubscriptionRecord>;
    commentFiles: View<CommentFile>;
    attempts: View<UploadAttempt>;
    feedbackThreads: View<FeedbackThread>;
    feedbackPosts: View<FeedbackPost>;
    feedbackFiles: View<FeedbackFile>;
    /** 読むたびに SELECT する（追加順） */
    readonly events: CommentEvent[];
    readonly grants: WorkPermissionGrant[];
    readonly audit: AuditEntry[];
    names: { set(id: string, name: string): void };
    emails: { set(id: string, email: string): void };
    members: { add(id: string): void };
    /** `${userId}|${threadId}` → 最後に読んだ時刻 */
    feedbackReads: { set(key: string, at: number): void };
    notificationPrefs: { readonly size: number };
    deliveries: { readonly size: number };
  };
}

/** メモリ上の node:sqlite。Durable Object の代わりにテストが使う */
export function nodeSql(): Sql {
  const db = new DatabaseSync(":memory:");
  return { exec: (query, ...params) => db.prepare(query).all(...params) };
}

export function createInMemoryContext(
  now = Date.UTC(2026, 10, 1),
  sql = nodeSql(),
): InMemoryContext {
  migrate(sql);
  const clock = new FakeClock(now);
  // 2 つの文脈に同じ操作をして結果を突き合わせるテストがあるので、ID は文脈ごとに 1 から数える
  let seq = 0;
  const newId = (table: string) => `${table}_${++seq}`;
  const ctx = createSqliteContext(sql, { clock, newId });
  // 利用者の表は人ごとに 1 行。名前・メール・委員かどうかを、テストが別々に置けるようにする
  const touch = (id: string, field?: "name" | "email", value?: string) =>
    sql.exec(
      field
        ? `INSERT INTO users (id, doc) VALUES (?, json_object('${field}', ?))
           ON CONFLICT (id) DO UPDATE SET doc = json_set(doc, '$.${field}', ?)`
        : "INSERT OR IGNORE INTO users (id, doc) VALUES (?, '{}')",
      ...(field ? [id, value ?? null, value ?? null] : [id]),
    );
  for (const p of Object.values(principals)) touch(p.userId);
  const count = (table: string) => Number(sql.exec(`SELECT count(*) AS n FROM ${table}`)[0]?.n);
  const rows = <T>(table: string) => new Rows<T>(sql, table).all();
  return {
    ...ctx,
    clock,
    state: {
      works: new Docs<Work>(sql, "works", newId),
      artifacts: new Docs<Artifact>(sql, "artifacts", newId),
      threads: new Docs<CommentThread>(sql, "threads", newId),
      confirmations: new Docs<ApprovalConfirmation>(sql, "confirmations", newId),
      checks: new Docs<RequiredCheck>(sql, "checks", newId),
      notifications: new Docs<Notification>(sql, "notifications", newId),
      pushSubscriptions: new Docs<PushSubscriptionRecord>(sql, "pushSubscriptions", newId),
      commentFiles: new Docs<CommentFile>(sql, "commentFiles", newId),
      attempts: new Docs<UploadAttempt>(sql, "uploadAttempts", newId),
      feedbackThreads: new Docs<FeedbackThread>(sql, "feedbackThreads", newId),
      feedbackPosts: new Docs<FeedbackPost>(sql, "feedbackPosts", newId),
      feedbackFiles: new Docs<FeedbackFile>(sql, "feedbackFiles", newId),
      get events() {
        return rows<CommentEvent>("events");
      },
      get grants() {
        return rows<WorkPermissionGrant>("grants");
      },
      get audit() {
        return rows<AuditEntry>("audit");
      },
      names: { set: (id, name) => void touch(id, "name", name) },
      emails: { set: (id, email) => void touch(id, "email", email) },
      members: { add: (id) => void touch(id) },
      // FB の読んだ印は読み取り専用のポートなので、書き口はここだけ（sqlite/context.ts の feedback.listReads と同じ形）
      feedbackReads: {
        set: (key, at) => {
          const [userId = "", threadId = ""] = key.split("|");
          sql.exec(
            `INSERT INTO feedbackReads (id, doc) VALUES (?, ?)
             ON CONFLICT (id) DO UPDATE SET doc = excluded.doc`,
            key,
            JSON.stringify({ userId, threadId, at }),
          );
        },
      },
      notificationPrefs: {
        get size() {
          return count("notificationPrefs");
        },
      },
      deliveries: {
        get size() {
          return count("deliveries");
        },
      },
    },
  };
}
