import { isWorkPinned, listSubmitTargets, setWorkPinned } from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { listSubmissionCandidates } from "./works.ts";

/**
 * ピン留め（W-26）と「版を提出」（L-15）のアダプタ。業務の判定は application / domain。
 */

/** FAB「版を提出」の候補: 自分が版を提出できる進行中の制作物（納期順） */
export const submitTargets = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    const works = await listSubmissionCandidates(ctx.db, principal);
    return runUseCase(() => listSubmitTargets(createReadContext(ctx.db), principal, works));
  },
});

/** ホームにピン留め／外す */
export const setPinned = mutation({
  args: { workId: v.string(), pinned: v.boolean() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => setWorkPinned(createAppContext(ctx), principal, args));
  },
});

export const pinned = query({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => isWorkPinned(createReadContext(ctx.db), principal, workId));
  },
});
