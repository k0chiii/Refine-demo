import {
  claimProofreadArtifact,
  failProofreadArtifact,
  getProofreadingRun,
  retryProofreadingRun,
  submitProofreadSegments,
} from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { vProofreadSegment } from "./lib/validators.ts";

/**
 * 提出時の自動校正。重い処理（PDF の文字の取り出し・OCR）はブラウザで行い、ここでは
 * 担当の割り当て・ルールの照合（サーバーでやり直す）・指摘の記録だけを行う（mutation で重い処理をしない）。
 */
export const run = query({
  args: { revisionId: v.string() },
  handler: async (ctx, { revisionId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => getProofreadingRun(createReadContext(ctx.db), principal, revisionId));
  },
});

export const claim = mutation({
  args: { runId: v.string(), artifactId: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => claimProofreadArtifact(createAppContext(ctx.db), principal, args));
  },
});

export const submit = mutation({
  args: {
    runId: v.string(),
    artifactId: v.string(),
    segments: v.array(vProofreadSegment),
    partial: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => submitProofreadSegments(createAppContext(ctx.db), principal, args));
  },
});

export const fail = mutation({
  args: { runId: v.string(), artifactId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await failProofreadArtifact(createAppContext(ctx.db), principal, args);
      return null;
    });
  },
});

export const retry = mutation({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await retryProofreadingRun(createAppContext(ctx.db), principal, args);
      return null;
    });
  },
});
