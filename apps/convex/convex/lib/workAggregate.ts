import { DirectAggregate } from "@convex-dev/aggregate";
import type { Work } from "@mf100/domain";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const workAggregate = new DirectAggregate<{ Key: [number, string]; Id: string }>(
  components.aggregate,
);

export async function syncWorkAggregate(ctx: MutationCtx, work: Work) {
  const previous = await ctx.db
    .query("workAggregateEntries")
    .withIndex("by_work", (q) => q.eq("workId", work.id as Id<"works">))
    .unique();
  const key: [number, string] = [work.year, work.lifecycle];
  const previousKey: [number, string] | null = previous
    ? [previous.year, previous.lifecycle]
    : null;
  if (previousKey && previousKey[0] === key[0] && previousKey[1] === key[1]) {
    await ctx.db.patch(work.id as Id<"works">, { aggregateVersion: 1 });
    return;
  }
  if (previous)
    await workAggregate.replaceOrInsert(ctx, { id: work.id, key: previousKey! }, { key });
  else await workAggregate.insertIfDoesNotExist(ctx, { id: work.id, key });
  if (previous)
    await ctx.db.patch(previous._id, {
      year: work.year,
      lifecycle: work.lifecycle,
    });
  else
    await ctx.db.insert("workAggregateEntries", {
      workId: work.id as Id<"works">,
      year: work.year,
      lifecycle: work.lifecycle,
    });
  await ctx.db.patch(work.id as Id<"works">, { aggregateVersion: 1 });
}
