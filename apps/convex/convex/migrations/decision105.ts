import { internalMutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { syncWorkAggregate } from "../lib/workAggregate";
import { workFromDoc } from "../lib/adapters";

/** 105A: works から confidentiality を除去（スキーマ削除前に 1 回実行） */
export const removeWorkConfidentiality = internalMutation({
  args: {},
  handler: async (ctx) => {
    let patchedWorks = 0;
    for (const doc of await ctx.db.query("works").collect()) {
      if (!("confidentiality" in doc)) continue;
      const { _id, _creationTime, confidentiality, ...rest } = doc as Doc<"works"> & {
        confidentiality?: string;
      };
      void confidentiality;
      const next = { ...rest, _id, _creationTime } as Doc<"works">;
      await ctx.db.replace(_id, rest);
      await syncWorkAggregate(ctx, workFromDoc(next));
      patchedWorks++;
    }
    let patchedEntries = 0;
    for (const entry of await ctx.db.query("workAggregateEntries").collect()) {
      if (!("confidentiality" in entry)) continue;
      const { _id, confidentiality, ...rest } = entry as Doc<"workAggregateEntries"> & {
        confidentiality?: string;
      };
      void confidentiality;
      await ctx.db.replace(_id, rest);
      patchedEntries++;
    }
    return { patchedWorks, patchedEntries };
  },
});
