import { syncWorkAggregate } from "./lib/workAggregate";
import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";
import type { GenericDataModel } from "convex/server";
import { internalMutation } from "./_generated/server";
import { syncWorkRoles, workFromDoc } from "./lib/adapters.ts";
import { syncWorkSummary } from "./lib/workSummary";
import { WORK_SEARCH_VERSION, syncWorkSearch } from "./lib/workSearch";
import { recountUnread } from "./lib/notificationCounters";
import schema from "./schema";

const migrations = new Migrations<GenericDataModel, typeof schema>(components.migrations, {
  schema,
  internalMutation,
  defaultBatchSize: 50,
});
/** Idempotent repair of a derived index; run dryRun first, never as part of deployment. */
export const backfillWorkRoles = migrations.define({
  table: "works",
  migrateOne: async (ctx, doc) => {
    await syncWorkRoles(ctx.db, workFromDoc(doc));
    await syncWorkAggregate(ctx, workFromDoc(doc));
  },
});

/**
 * Fill `workSummaries` to summaryVersion 2 for every work.
 * Idempotent. Operator-approved only (CLAUDE.md). Run via Migrations component / dashboard, not deploy.
 */
export const backfillWorkSummaries = migrations.define({
  table: "works",
  migrateOne: async (ctx, doc) => {
    await syncWorkSummary(ctx.db, doc._id);
  },
});

/**
 * 検索の行（workSearch）を揃える（2026-11-06。docs/DECISIONS.md「検索の token を別の表に」）。
 * 制作物ごとに検索の行を作り（今の題名などから作り直す）、印 searchVersion を付ける。works の searchTokens の欄は
 * この移行を流したあとで外した（同日）。検索の行が無い制作物（シードなど）を揃えるのにも使える。
 * 業務の version は変えない。Idempotent。Operator-approved only: run after deploy, never as part of deployment.
 */
export const moveWorkSearchTokens = migrations.define({
  table: "works",
  migrateOne: async (ctx, doc) => {
    await syncWorkSearch(ctx.db, workFromDoc(doc));
    if (doc.searchVersion !== WORK_SEARCH_VERSION)
      await ctx.db.patch(doc._id, { searchVersion: WORK_SEARCH_VERSION });
  },
});

/**
 * 利用者ごとの未読の通知の数（notificationCounters）を数え直して埋める（2026-11-06）。
 * 行が無い利用者は unreadCount が未読の索引で 100 件まで数える（移行前も正しい）。埋めると 1 行だけ読む。
 * Idempotent（数え直して書く）。運用者が実行する。デプロイでは走らない。
 * 未読が多い利用者は 1 人で多くの行を読むので、1 回の人数を少なくする。
 */
export const backfillNotificationCounters = migrations.define({
  table: "users",
  batchSize: 10,
  migrateOne: async (ctx, user) => {
    await recountUnread(ctx.db, user._id);
  },
});
