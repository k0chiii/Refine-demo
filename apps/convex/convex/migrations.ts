import { upsertRevisionPlannedAt } from "@mf100/domain";
import { syncWorkAggregate } from "./lib/workAggregate";
import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";
import type { GenericDataModel } from "convex/server";
import { internalMutation } from "./_generated/server";
import { syncWorkRoles, workFromDoc } from "./lib/adapters.ts";
import { syncWorkSummary } from "./lib/workSummary";
import { WORK_SEARCH_VERSION, syncWorkSearch } from "./lib/workSearch";
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

/** revisions.plannedSubmitAt → works.revisionPlannedAt（decisions 82 / 072 置換）。Idempotent。 */
export const backfillRevisionPlannedAt = migrations.define({
  table: "revisions",
  migrateOne: async (ctx, rev) => {
    const at = rev.plannedSubmitAt;
    if (at == null) return;
    const work = await ctx.db.get(rev.workId);
    if (!work) return;
    const next = upsertRevisionPlannedAt(work.revisionPlannedAt, rev.sequence, at);
    if (JSON.stringify(work.revisionPlannedAt ?? []) === JSON.stringify(next)) return;
    await ctx.db.patch(work._id, { revisionPlannedAt: next });
  },
});

/**
 * works.searchTokens → workSearch（2026-11-06。docs/DECISIONS.md「検索の token を別の表に」）。
 * 制作物ごとに検索の行を作り（今の題名などから作り直す）、works から token を外して印 searchVersion を付ける。
 * 業務の version は変えない。Idempotent。Operator-approved only: run after deploy, never as part of deployment.
 */
export const moveWorkSearchTokens = migrations.define({
  table: "works",
  migrateOne: async (ctx, doc) => {
    await syncWorkSearch(ctx.db, workFromDoc(doc));
    if (doc.searchTokens !== undefined || doc.searchVersion !== WORK_SEARCH_VERSION)
      await ctx.db.patch(doc._id, { searchTokens: undefined, searchVersion: WORK_SEARCH_VERSION });
  },
});
