import { getAlignmentOverride, saveAlignmentOverride } from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

const vPair = v.object({
  left: v.union(v.number(), v.null()),
  right: v.union(v.number(), v.null()),
});

/** 版比較の手動ページ対応（読むのは両方の制作物の閲覧権限、直すのは表示中の制作物で校正に関わる人。別の制作物の版とも比べられる） */
export const getOverride = query({
  args: { leftArtifactId: v.string(), rightArtifactId: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const row = await getAlignmentOverride(
        createReadContext(ctx.db),
        principal,
        args.leftArtifactId,
        args.rightArtifactId,
      );
      return row ? { pairs: row.pairs, updatedAt: row.updatedAt } : null;
    });
  },
});

export const saveOverride = mutation({
  args: { leftArtifactId: v.string(), rightArtifactId: v.string(), pairs: v.array(vPair) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await saveAlignmentOverride(createAppContext(ctx), principal, args);
      return null;
    });
  },
});
