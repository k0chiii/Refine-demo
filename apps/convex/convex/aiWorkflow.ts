import { WorkflowManager } from "@convex-dev/workflow";
import { loadAuthorizedWork, resolveRulesForWork } from "@mf100/application";
import { aiBlockReason, isAllowed, placeAiCandidates } from "@mf100/domain";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { createReadContext } from "./lib/adapters";
import { principalOf, requireUser } from "./lib/principal";
import { aiConfig, createProvider } from "./lib/ai/provider";
import { reserveAi } from "./ai";

const workflows = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: 2 },
});
const jobId = v.id("aiJobs");

/** Durable steps contain only IDs/null. Text stays in the existing draft, results expire after one hour. */
export const run = workflows.define({
  args: { jobId },
  returns: v.null(),
  handler: async (step, args): Promise<null> => {
    await step.runAction(internal.aiWorkflow.execute, args, { retry: false });
    return null;
  },
});

export const start = mutation({
  args: { workId: v.string(), draftVersion: v.number(), consentToTemporaryStorage: v.boolean() },
  handler: async (ctx, args): Promise<string> => {
    const { principal, user } = await requireUser(ctx);
    if (!args.consentToTemporaryStorage) throw new Error("temporary_storage_consent_required");
    const { work } = await loadAuthorizedWork(
      createReadContext(ctx.db),
      principal,
      args.workId,
      "revision.submit",
    );
    if (aiBlockReason(aiConfig().policy)) throw new Error("ai_unavailable");
    const draft = await createReadContext(ctx.db).documents.findByWork(args.workId);
    if (!draft || draft.version !== args.draftVersion || !draft.text.trim())
      throw new Error("draft_changed");
    const active = await ctx.db
      .query("aiJobs")
      .withIndex("by_user_work", (q) => q.eq("userId", user._id).eq("workId", work.id))
      .collect();
    const pending = active.find(
      (j) => (j.state === "queued" || j.state === "running") && j.expiresAt > Date.now(),
    );
    if (pending) return pending._id;
    const quota = await reserveAi(ctx, principal, work.id, draft.text.length);
    if (!quota.ok) throw new Error("ai_quota_exceeded");
    const id = await ctx.db.insert("aiJobs", {
      workId: work.id,
      userId: user._id,
      draftVersion: draft.version,
      state: "queued",
      createdAt: Date.now(),
      expiresAt: Date.now() + 3_600_000,
    });
    const workflowId = await workflows.start(ctx, internal.aiWorkflow.run, { jobId: id });
    await ctx.db.patch(id, { workflowId });
    return id;
  },
});

export const prepare = internalQuery({
  args: { jobId },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.expiresAt <= Date.now() || job.state === "cancelled")
      throw new Error("job_expired");
    const user = await ctx.db.get(job.userId);
    if (!user) throw new Error("forbidden");
    const principal = principalOf(user);
    const app = createReadContext(ctx.db);
    const { work, grants } = await loadAuthorizedWork(
      app,
      principal,
      job.workId,
      "revision.submit",
    );
    if (
      !isAllowed("revision.submit", { principal, work, grants }) ||
      aiBlockReason(aiConfig().policy)
    )
      throw new Error("forbidden");
    const draft = await app.documents.findByWork(work.id);
    if (!draft || draft.version !== job.draftVersion) throw new Error("draft_changed");
    const rules = await resolveRulesForWork(app, principal, work.id);
    return { job, text: draft.text, rules: rules.rules };
  },
});

export const finish = internalMutation({
  args: { jobId, result: v.optional(v.string()), failed: v.boolean() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || !["queued", "running"].includes(job.state) || job.expiresAt <= Date.now()) return;
    if (args.failed) {
      await ctx.db.patch(job._id, { state: "failed", error: "AI の処理を完了できませんでした" });
      return;
    }
    // Recheck permission, policy and draft version after the external call.
    await ctx.runQuery(internal.aiWorkflow.prepare, { jobId: job._id });
    await ctx.db.patch(job._id, { state: "completed", result: args.result });
  },
});

export const claim = internalMutation({
  args: { jobId },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.state !== "queued" || job.expiresAt <= Date.now()) return false;
    await ctx.db.patch(job._id, { state: "running" });
    return true;
  },
});

export const execute = internalAction({
  args: { jobId },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (!(await ctx.runMutation(internal.aiWorkflow.claim, args))) return null;
    try {
      const prepared = await ctx.runQuery(internal.aiWorkflow.prepare, args);
      const provider = await createProvider(aiConfig());
      const candidates = placeAiCandidates(
        prepared.text,
        await provider.proofread({ text: prepared.text, rules: prepared.rules }),
        new Map(prepared.rules.map((r) => [r.ruleId, r.revision])),
      );
      await ctx.runMutation(internal.aiWorkflow.finish, {
        ...args,
        failed: false,
        result: JSON.stringify({ candidates, provider: provider.name, model: provider.model }),
      });
    } catch {
      await ctx.runMutation(internal.aiWorkflow.finish, { ...args, failed: true });
    }
    return null;
  },
});

export const get = query({
  args: { jobId },
  handler: async (ctx, args) => {
    const { user, principal } = await requireUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id || job.expiresAt <= Date.now()) return null;
    await loadAuthorizedWork(createReadContext(ctx.db), principal, job.workId, "revision.submit");
    return {
      state: job.state,
      result: job.result ?? null,
      error: job.error ?? null,
      expiresAt: job.expiresAt,
    };
  },
});

export const cancel = mutation({
  args: { jobId },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) throw new Error("forbidden");
    await ctx.db.patch(job._id, { state: "cancelled", result: undefined });
    if (job.workflowId)
      await workflows.cancel(ctx, job.workflowId as Parameters<typeof workflows.cancel>[1]);
  },
});
export const expire = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("aiJobs")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(50);
    for (const job of expired) {
      if (job.workflowId) {
        const id = job.workflowId as Parameters<typeof workflows.cancel>[1];
        await workflows.cancel(ctx, id);
        await workflows.cleanup(ctx, id);
      }
      await ctx.db.delete(job._id);
    }
  },
});
