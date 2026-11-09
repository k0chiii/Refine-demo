import { getAlignmentOverride, saveAlignmentOverride } from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/comparisons.ts の写し

const vPair = object({ left: z.number().nullable(), right: z.number().nullable() });

export const comparisons = {
  /** 版比較の手動ページ対応（読むのは両方の制作物の閲覧権限、直すのは表示中の制作物で校正に関わる人） */
  "comparisons:getOverride": query({
    auth: "user",
    args: object({ leftArtifactId: z.string(), rightArtifactId: z.string() }),
    handler: async (ctx, args) => {
      const row = await getAlignmentOverride(
        ctx.db,
        ctx.principal!,
        args.leftArtifactId,
        args.rightArtifactId,
      );
      return row ? { pairs: row.pairs, updatedAt: row.updatedAt } : null;
    },
  }),

  "comparisons:saveOverride": mutation({
    auth: "user",
    args: object({
      leftArtifactId: z.string(),
      rightArtifactId: z.string(),
      pairs: z.array(vPair),
    }),
    handler: async (ctx, args) => {
      await saveAlignmentOverride(ctx.db, ctx.principal!, args);
      return null;
    },
  }),
} satisfies Record<string, FnDef>;
