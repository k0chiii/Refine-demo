import {
  claimProofreadArtifact,
  failProofreadArtifact,
  getProofreadingRun,
  retryProofreadingRun,
  submitProofreadSegments,
} from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object, vProofreadSegment } from "./validators.ts";

// apps/convex/convex/proofreading.ts の写し。重い処理（PDF の文字の取り出し・OCR）はブラウザで行い、
// ここでは担当の割り当て・ルールの照合・指摘の記録だけを行う

export const proofreading = {
  "proofreading:run": query({
    auth: "user",
    args: object({ revisionId: z.string() }),
    handler: async (ctx, { revisionId }) => getProofreadingRun(ctx.db, ctx.principal!, revisionId),
  }),

  "proofreading:claim": mutation({
    auth: "user",
    args: object({ runId: z.string(), artifactId: z.string() }),
    handler: async (ctx, args) => claimProofreadArtifact(ctx.db, ctx.principal!, args),
  }),

  "proofreading:submit": mutation({
    auth: "user",
    args: object({
      runId: z.string(),
      artifactId: z.string(),
      segments: z.array(vProofreadSegment),
      partial: z.boolean().optional(),
    }),
    handler: async (ctx, args) => submitProofreadSegments(ctx.db, ctx.principal!, args),
  }),

  "proofreading:fail": mutation({
    auth: "user",
    args: object({ runId: z.string(), artifactId: z.string(), error: z.string() }),
    handler: async (ctx, args) => {
      await failProofreadArtifact(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  "proofreading:retry": mutation({
    auth: "user",
    args: object({ runId: z.string() }),
    handler: async (ctx, args) => {
      await retryProofreadingRun(ctx.db, ctx.principal!, args);
      return null;
    },
  }),
} satisfies Record<string, FnDef>;
