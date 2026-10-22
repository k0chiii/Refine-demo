import { syncWorkAggregate } from "./lib/workAggregate";
import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";
import type { GenericDataModel } from "convex/server";
import { internalMutation } from "./_generated/server";
import { syncWorkRoles, workFromDoc } from "./lib/adapters.ts";
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
