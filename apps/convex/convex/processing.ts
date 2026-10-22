import { RateLimiter, DAY } from "@convex-dev/rate-limiter";
import { isAllowed } from "@mf100/domain";
import { components } from "./_generated/api";
import {
  beginItemUpload,
  completeItemUpload,
  failItemUpload,
  loadAuthorizedWork,
  resumeItemUpload,
} from "@mf100/application";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { createAppContext, createReadContext } from "./lib/adapters";
import { principalOf, requireUser } from "./lib/principal";
import { processingKind, processingOptions, processingOutput } from "./lib/processingValidators";
import { vFigmaImportMeta } from "./lib/validators";
const limiter = new RateLimiter(components.rateLimiter, {
  processingUser: { kind: "fixed window", rate: 20, period: DAY },
  processingWork: { kind: "fixed window", rate: 40, period: DAY },
});
const enabledKinds = () =>
  (process.env.PROCESSING_CAPABILITIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
export const status = query({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    const { work, grants } = await loadAuthorizedWork(
      createReadContext(ctx.db),
      principal,
      workId,
      "work.view",
    );
    const enabled =
      process.env.PROCESSING_ENABLED === "true" &&
      isAllowed("revision.submit", { principal, work, grants }) &&
      work.lifecycle === "active" &&
      (work.confidentiality !== "restricted" || process.env.PROCESSING_ALLOW_RESTRICTED === "true");
    return { enabled, kinds: enabled ? enabledKinds() : [] };
  },
});
const jobId = v.id("processingJobs");

async function authorize(ctx: QueryCtx | MutationCtx, job: Doc<"processingJobs">, write = true) {
  const user = await ctx.db.get(job.userId);
  if (!user) throw new Error("forbidden");
  const principal = principalOf(user);
  const { work } = await loadAuthorizedWork(
    createReadContext(ctx.db),
    principal,
    job.workId,
    write ? "revision.submit" : "work.view",
  );
  if (write && work.lifecycle !== "active") throw new Error("work_not_active");
  if (work.confidentiality === "restricted" && process.env.PROCESSING_ALLOW_RESTRICTED !== "true")
    throw new Error("restricted_processing_disabled");
  return principal;
}

export const create = mutation({
  args: { kind: processingKind, options: processingOptions, consentToProcessing: v.boolean() },
  handler: async (ctx, args): Promise<Id<"processingJobs">> => {
    const { user, principal } = await requireUser(ctx);
    if (
      process.env.PROCESSING_ENABLED !== "true" ||
      !enabledKinds().includes(args.kind) ||
      !args.consentToProcessing
    )
      throw new Error("processing_disabled_or_consent_missing");
    let workId = args.options.workId;
    let existingJob: Id<"processingJobs"> | undefined;
    if (args.options.artifactId) {
      const artifact = await ctx.db.get(args.options.artifactId);
      const revision = artifact ? await ctx.db.get(artifact.revisionId as Id<"revisions">) : null;
      if (!artifact?.objectKey || !revision || (workId && workId !== revision.workId))
        throw new Error("forbidden");
      workId = revision.workId as Id<"works">;
      const mime = artifact.mimeType;
      if (
        (args.kind === "image" && !mime.startsWith("image/")) ||
        (["video-frame", "stream"].includes(args.kind) && !mime.startsWith("video/")) ||
        (args.kind === "container-preview" &&
          mime !== "application/pdf" &&
          !mime.startsWith("video/"))
      )
        throw new Error("invalid_processing_media");
    }
    if (args.kind === "figma" && args.options.itemId) {
      const item = await ctx.db.get(args.options.itemId);
      const session = item ? await ctx.db.get(item.sessionId) : null;
      if (
        !item ||
        item.origin?.kind !== "figma" ||
        !session ||
        session.submittedBy !== user._id ||
        (workId && session.workId !== workId)
      )
        throw new Error("forbidden");
      workId = session.workId as Id<"works">;
      const existing = await ctx.db
        .query("processingJobs")
        .withIndex("by_item", (q) => q.eq("options.itemId", args.options.itemId))
        .collect();
      const pending = existing.find((j) => ["queued", "running", "ready"].includes(j.state));
      if (pending) existingJob = pending._id;
    } else if (args.kind === "figma") throw new Error("item_required");
    if (args.kind !== "figma" && args.kind !== "web-snapshot" && !args.options.artifactId)
      throw new Error("artifact_required");
    if (args.kind === "web-snapshot") {
      const url = new URL(args.options.url ?? "");
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        url.href.length > 2048
      )
        throw new Error("invalid_snapshot_url");
    }
    if (
      args.options.time !== undefined &&
      (!Number.isFinite(args.options.time) || args.options.time < 0 || args.options.time > 3600)
    )
      throw new Error("invalid_frame_time");
    if (!workId) throw new Error("work_required");
    const { work } = await loadAuthorizedWork(
      createReadContext(ctx.db),
      principal,
      workId,
      "revision.submit",
    );
    if (
      work.lifecycle !== "active" ||
      (work.confidentiality === "restricted" && process.env.PROCESSING_ALLOW_RESTRICTED !== "true")
    )
      throw new Error("processing_not_allowed");
    if (existingJob) return existingJob;
    const jobs = await ctx.db
      .query("processingJobs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const duplicate = jobs.find(
      (j) =>
        ["queued", "running"].includes(j.state) &&
        j.kind === args.kind &&
        JSON.stringify(j.options) === JSON.stringify(args.options),
    );
    if (duplicate) return duplicate._id;
    if (jobs.filter((j) => ["queued", "running"].includes(j.state)).length >= 3)
      throw new Error("processing_quota_exceeded");
    if (
      !(await limiter.limit(ctx, "processingUser", { key: user._id })).ok ||
      !(await limiter.limit(ctx, "processingWork", { key: workId })).ok
    )
      throw new Error("processing_quota_exceeded");
    const attempt =
      args.kind === "figma"
        ? await beginItemUpload(createAppContext(ctx), principal, { itemId: args.options.itemId! })
        : null;
    return ctx.db.insert("processingJobs", {
      kind: args.kind,
      options: args.options,
      workId,
      userId: user._id,
      state: "queued",
      ...(attempt ? { attemptId: attempt.attemptId } : {}),
      createdAt: Date.now(),
    });
  },
});

export const inspect = internalQuery({
  args: { jobId },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || ["failed", "cancelled"].includes(job.state)) throw new Error("job_unavailable");
    await authorize(ctx, job);
    const artifact = job.options.artifactId ? await ctx.db.get(job.options.artifactId) : null;
    const item = job.options.itemId ? await ctx.db.get(job.options.itemId) : null;
    const attempt = job.attemptId ? await ctx.db.get(job.attemptId as Id<"uploadAttempts">) : null;
    return {
      job,
      adopted: attempt?.state === "adopted",
      source: artifact?.objectKey ?? null,
      mimeType: artifact?.mimeType ?? null,
      origin: item?.origin ?? null,
      target: attempt
        ? {
            attemptId: attempt._id,
            objectKey: attempt.objectKey,
            mimeType: item!.mimeType,
            declaredSize: item!.declaredSize ?? null,
            fileName: item!.fileName,
          }
        : null,
    };
  },
});
export const complete = internalMutation({
  args: { jobId, output: processingOutput },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("job_not_found");
    await authorize(ctx, job);
    if (job.state === "ready") return;
    if (["failed", "cancelled"].includes(job.state)) throw new Error("job_unavailable");
    if (args.output.key && args.output.key !== `derived/${job._id}/result`)
      throw new Error("invalid_derived_key");
    if (args.output.streamUid && args.output.streamUid !== job.streamUid)
      throw new Error("invalid_stream_uid");
    await ctx.db.patch(job._id, { state: "ready", output: args.output });
  },
});
export const fail = internalMutation({
  args: { jobId },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job && job.state !== "ready")
      await ctx.db.patch(job._id, { state: "failed", error: "処理を完了できませんでした" });
  },
});
export const figmaComplete = internalMutation({
  args: { jobId, size: v.number(), sha256: v.string(), figma: vFigmaImportMeta },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job?.attemptId || job.kind !== "figma") throw new Error("invalid_job");
    const principal = await authorize(ctx, job);
    const target = await resumeItemUpload(createAppContext(ctx), principal, {
      attemptId: job.attemptId,
    });
    if (target.adopted) return { status: "verified", failureMessage: null };
    const result = await completeItemUpload(createAppContext(ctx), principal, {
      attemptId: job.attemptId,
      size: args.size,
      sha256: args.sha256,
      figma: args.figma,
    });
    return { status: result.status, failureMessage: result.failureMessage ?? null };
  },
});
export const streamSession = internalMutation({
  args: { jobId, uid: v.string(), uploadUrl: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.kind !== "stream") throw new Error("invalid_job");
    await authorize(ctx, job);
    if (!/^[a-f0-9]{32}$/.test(args.uid)) throw new Error("invalid_stream_uid");
    const url = new URL(args.uploadUrl);
    if (
      url.protocol !== "https:" ||
      !["upload.videodelivery.net", "upload.cloudflarestream.com"].includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw new Error("invalid_stream_url");
    if (job.streamUid && job.streamUid !== args.uid) throw new Error("stream_already_reserved");
    await ctx.db.patch(job._id, { streamUid: args.uid, streamUploadUrl: args.uploadUrl });
  },
});
export const get = query({
  args: { jobId },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("forbidden");
    await loadAuthorizedWork(createReadContext(ctx.db), principal, job.workId, "work.view");
    return {
      id: job._id,
      kind: job.kind,
      state: job.state,
      output: job.output ?? null,
      error: job.error ?? null,
    };
  },
});
export const cancel = mutation({
  args: { jobId },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id || job.state === "ready") throw new Error("forbidden");
    await ctx.db.patch(job._id, { state: "cancelled" });
    if (job.attemptId)
      await failItemUpload(createAppContext(ctx), principalOf(user), {
        attemptId: job.attemptId,
        message: "processing_cancelled",
      });
  },
});

/** Terminal jobs cannot adopt an output later; cleanup may delete only their own immutable derived key. */
export const cleanupCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 3_600_000;
    const result = [];
    for (const state of ["failed", "cancelled"] as const) {
      const jobs = await ctx.db
        .query("processingJobs")
        .withIndex("by_state_cleaned", (q) =>
          q.eq("state", state).eq("cleaned", undefined).lt("createdAt", cutoff),
        )
        .take(25);
      result.push(
        ...jobs.map((j) => ({
          jobId: j._id,
          key: `derived/${j._id}/result`,
          streamUid: j.streamUid ?? null,
        })),
      );
    }
    return result;
  },
});
export const markCleaned = internalMutation({
  args: { jobId },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job && ["failed", "cancelled"].includes(job.state))
      await ctx.db.patch(job._id, { cleaned: true, streamUploadUrl: undefined });
  },
});
export const expire = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const state of ["queued", "running"] as const) {
      const jobs = await ctx.db
        .query("processingJobs")
        .withIndex("by_state", (q) =>
          q.eq("state", state).lt("createdAt", Date.now() - 6 * 3_600_000),
        )
        .take(50);
      for (const job of jobs)
        await ctx.db.patch(job._id, { state: "failed", error: "処理の期限が切れました" });
    }
  },
});
