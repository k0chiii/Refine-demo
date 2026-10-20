import {
  addFeedbackMigrationResult,
  emptyFeedbackMigrationTotals,
  isFeedbackThreadSettled,
  mergeFeedbackMigrationTotals,
  migrateFeedbackThread,
  previewFeedbackThreadMigration,
  topFeedbackMigrationWorks,
  type FeedbackMigrationTotals,
} from "@mf100/application";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";

/**
 * FB（フィードバック）のコメントへの移行と、移行後の削除（利用者決定 2026-10-20）。
 * 規則は domain の feedback/migration.ts、手順は application の usecases/feedbackMigration.ts。ここは分割実行のアダプタ。
 *
 * すべて内部関数（公開 API に出さない）。本番では Deploy の手動起動（fb_migration）から、デプロイキーで
 * `convex run feedbackMigration:run '{"mode":"dry-run"|"migrate"|"delete"}'` として流す。
 * - dry-run: 何も書かず、移したときの件数を返す。
 * - migrate: コメントへ移す。何度流しても増えない（移行済みは飛ばす）。
 * - delete: 全ての FB のスレッドの移行が済んでいることを確かめてから、FB の行を全て消す。移せなかった生きたスレッド（版の無い制作物など）が 1 つでもあれば何も消さない。
 * 1 回の呼び出し（run は action）が、バッチを順に進めて最後までやり、まとめを返す。時間が長くかかるときは
 * 自分を予約して続きを流し（continued: true）、続きの結果は関数のログに出る。
 */

/** 1 回のトランザクションで扱うスレッド数（移すときは 1 スレッドが複数の行を書くので少なめ） */
const MIGRATE_BATCH = 10;
const SCAN_BATCH = 50;
/** 1 回のトランザクションで消す行数 */
const DELETE_BATCH = 300;
/** action の上限（10 分）に収めるための持ち時間。超えたら続きを予約する */
const TIME_BUDGET_MS = 5 * 60_000;

const vCursor = v.union(v.number(), v.null());

export type FeedbackMigrationMode = "dry-run" | "migrate" | "delete";
const vMode = v.union(v.literal("dry-run"), v.literal("migrate"), v.literal("delete"));

const FEEDBACK_TABLES = [
  "feedbackReads",
  "feedbackFiles",
  "feedbackPosts",
  "feedbackThreads",
] as const;
type FeedbackTable = (typeof FEEDBACK_TABLES)[number];
const vTable = v.union(
  v.literal("feedbackReads"),
  v.literal("feedbackFiles"),
  v.literal("feedbackPosts"),
  v.literal("feedbackThreads"),
);

// ---------------------------------------------------------------- バッチ（内部の query / mutation）

/** 数えるだけ（書かない）。前の続きから SCAN_BATCH 件 */
export const dryRunBatch = internalQuery({
  args: { cursor: vCursor },
  handler: async (ctx, { cursor }) => {
    const app = createReadContext(ctx.db);
    const page = await app.feedback.pageThreads(cursor, SCAN_BATCH);
    const totals = emptyFeedbackMigrationTotals();
    for (const thread of page.threads)
      addFeedbackMigrationResult(totals, await previewFeedbackThreadMigration(app, thread));
    return { totals, nextCursor: page.nextCursor };
  },
});

/** コメントへ移す。前の続きから MIGRATE_BATCH 件（1 つのトランザクション） */
export const migrateBatch = internalMutation({
  args: { cursor: vCursor },
  handler: async (ctx, { cursor }) => {
    const app = createAppContext(ctx);
    const page = await app.feedback.pageThreads(cursor, MIGRATE_BATCH);
    const totals = emptyFeedbackMigrationTotals();
    for (const thread of page.threads)
      addFeedbackMigrationResult(totals, await migrateFeedbackThread(app, thread));
    return { totals, nextCursor: page.nextCursor };
  },
});

/** 削除の前の確認: 移すべきなのに移っていないスレッドの数 */
export const verifyBatch = internalQuery({
  args: { cursor: vCursor },
  handler: async (ctx, { cursor }) => {
    const app = createReadContext(ctx.db);
    const page = await app.feedback.pageThreads(cursor, SCAN_BATCH);
    let unsettled = 0;
    for (const thread of page.threads)
      if (!(await isFeedbackThreadSettled(app, thread))) unsettled++;
    return { scanned: page.threads.length, unsettled, nextCursor: page.nextCursor };
  },
});

/**
 * 1 つの表から DELETE_BATCH 件の行を消す。R2 の実体には触れない（移した添付が同じ実体を指しているため、
 * 清掃（purge）の対象にもしない。FB の添付の行を消すだけで、実体の削除は予約しない）。
 */
export const deleteBatch = internalMutation({
  args: { table: vTable },
  handler: async (ctx, { table }) => {
    const rows = await ctx.db.query(table).take(DELETE_BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length, done: rows.length < DELETE_BATCH };
  },
});

// ---------------------------------------------------------------- 入口（action）

export interface FeedbackMigrationSummary {
  mode: FeedbackMigrationMode;
  /** false: 時間切れで続きを予約した（続きの結果は関数のログに出る） */
  completed: boolean;
  continued?: true;
  /** 数えた（dry-run）・移した（migrate）スレッドの内訳。delete では出さない */
  counts?: Record<string, number>;
  /** 移すスレッドが多い制作物（上位 20。ID のみ） */
  topWorks?: Array<{ workId: string; threads: number }>;
  /** delete: 移っていないスレッドが残っていて、何も消さなかった */
  refused?: true;
  unsettledThreads?: number;
  /** delete: 表ごとに消した行数 */
  deleted?: Record<FeedbackTable, number>;
}

function countsOf(mode: FeedbackMigrationMode, t: FeedbackMigrationTotals) {
  const open = mode === "dry-run" ? "willBeOpen" : "open";
  const resolved = mode === "dry-run" ? "willBeResolved" : "resolved";
  return {
    scanned: t.scanned,
    threads: t.threads,
    replies: t.replies,
    files: t.files,
    filesSkipped: t.filesSkipped,
    reads: t.reads,
    skippedNoRevision: t.skippedNoRevision,
    skippedNotLive: t.skippedNotLive,
    alreadyMigrated: t.alreadyMigrated,
    [open]: t.open,
    [resolved]: t.resolved,
  };
}

const scheduleContinuation = async (
  ctx: ActionCtx,
  args: {
    mode: FeedbackMigrationMode;
    cursor: number | null;
    totals: FeedbackMigrationTotals;
    verified?: boolean;
  },
) => {
  await ctx.scheduler.runAfter(0, internal.feedbackMigration.run, args);
};

/**
 * FB の移行・削除の入口。`convex run feedbackMigration:run '{"mode":"dry-run"}'`。
 * cursor / totals / verified は、時間切れで自分が予約した続きが使う（手で渡さない）。
 */
export const run = internalAction({
  args: {
    mode: vMode,
    cursor: v.optional(vCursor),
    totals: v.optional(v.any()),
    verified: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<FeedbackMigrationSummary> => {
    const startedAt = Date.now();
    const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;
    const { mode } = args;
    let summary: FeedbackMigrationSummary;

    if (mode === "delete") {
      let unsettled = 0;
      if (args.verified !== true) {
        // 削除の前に、全ての FB のスレッドの移行が済んでいることを確かめる。済んでいなければ何も消さない
        let cursor: number | null = null;
        do {
          const r: { scanned: number; unsettled: number; nextCursor: number | null } =
            await ctx.runQuery(internal.feedbackMigration.verifyBatch, { cursor });
          unsettled += r.unsettled;
          cursor = r.nextCursor;
        } while (cursor !== null);
      }
      if (unsettled > 0) {
        summary = { mode, completed: true, refused: true, unsettledThreads: unsettled };
      } else {
        const deleted = Object.fromEntries(FEEDBACK_TABLES.map((t) => [t, 0])) as Record<
          FeedbackTable,
          number
        >;
        let finished = true;
        // 読み取りの依存が少ない順（既読 → 添付 → 投稿 → スレッド）
        for (const table of FEEDBACK_TABLES) {
          for (;;) {
            if (outOfTime()) {
              finished = false;
              break;
            }
            const r: { deleted: number; done: boolean } = await ctx.runMutation(
              internal.feedbackMigration.deleteBatch,
              { table },
            );
            deleted[table] += r.deleted;
            if (r.done) break;
          }
          if (!finished) break;
        }
        if (!finished) {
          await scheduleContinuation(ctx, {
            mode,
            cursor: null,
            totals: emptyFeedbackMigrationTotals(),
            verified: true,
          });
          summary = { mode, completed: false, continued: true, deleted };
        } else summary = { mode, completed: true, deleted };
      }
    } else {
      let totals: FeedbackMigrationTotals = args.totals ?? emptyFeedbackMigrationTotals();
      let cursor: number | null = args.cursor ?? null;
      let finished = true;
      do {
        const r: { totals: FeedbackMigrationTotals; nextCursor: number | null } =
          mode === "dry-run"
            ? await ctx.runQuery(internal.feedbackMigration.dryRunBatch, { cursor })
            : await ctx.runMutation(internal.feedbackMigration.migrateBatch, { cursor });
        totals = mergeFeedbackMigrationTotals(totals, r.totals);
        cursor = r.nextCursor;
        if (cursor !== null && outOfTime()) {
          finished = false;
          break;
        }
      } while (cursor !== null);
      if (!finished) await scheduleContinuation(ctx, { mode, cursor, totals });
      summary = {
        mode,
        completed: finished,
        ...(finished ? {} : { continued: true as const }),
        counts: countsOf(mode, totals),
        topWorks: topFeedbackMigrationWorks(totals, 20),
      };
    }
    console.log(`[feedbackMigration] ${JSON.stringify(summary)}`);
    return summary;
  },
});
