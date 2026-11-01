import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./lib/principal";
import { workAggregate } from "./lib/workAggregate";

export const counts = query({
  args: { year: v.number() },
  handler: async (ctx, { year }) => {
    const { principal } = await requireUser(ctx);
    // Missing component entries during rollout must not silently undercount.
    const legacy = await ctx.db
      .query("works")
      .withIndex("by_aggregate_version", (q) => q.eq("aggregateVersion", undefined))
      .first();
    if (legacy) return { ready: false, counts: [] };
    const counts = [];
    for (const lifecycle of ["draft", "active", "on_hold", "finalized", "cancelled"]) {
      const count = await workAggregate.count(ctx, {
        bounds: { prefix: [year, lifecycle] },
      });
      counts.push({ lifecycle, count });
    }
    void principal;
    return { ready: true, counts };
  },
});
