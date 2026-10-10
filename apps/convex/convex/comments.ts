import { decideThread, postComment, replyToThread } from "@mf100/application";
import { DomainError, isAllowed } from "@mf100/domain";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { resolveUsers } from "./lib/users.ts";
import { vDecision, vSeverity, vThreadKind } from "./lib/validators.ts";
import { anchorValidator } from "./schema.ts";
import { loadAuthorizedWork } from "@mf100/application";

/** 新規指摘（F-06 / F-07 / A-04）。 */
export const post = mutation({
  args: {
    revisionId: v.id("revisions"),
    body: v.string(),
    kind: vThreadKind,
    severity: vSeverity,
    anchor: v.optional(anchorValidator),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const thread = await postComment(createAppContext(ctx.db), principal, args);
      return thread.id;
    });
  },
});

export const reply = mutation({
  args: { threadId: v.id("commentThreads"), body: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await replyToThread(createAppContext(ctx.db), principal, args);
      return null;
    });
  },
});

/** 採否判断（A-07）。 */
export const decide = mutation({
  args: { threadId: v.id("commentThreads"), action: vDecision, reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const t = await decideThread(createAppContext(ctx.db), principal, args);
      return t.resolution;
    });
  },
});

/** スレッドの履歴（返信・採否・訂正）。 */
export const events = query({
  args: { threadId: v.id("commentThreads") },
  handler: async (ctx, { threadId }) => {
    const { principal } = await requireUser(ctx);
    const app = createReadContext(ctx.db);
    return runUseCase(async () => {
      const thread = await app.threads.findById(threadId);
      if (!thread) throw new DomainError("forbidden", { threadId });
      const revision = await app.revisions.findById(thread.revisionId);
      if (!revision) throw new DomainError("forbidden", { threadId });
      const { work, grants } = await loadAuthorizedWork(
        app,
        principal,
        revision.workId,
        "work.view",
      );
      const events = await app.threads.listEvents(threadId);
      const users = await resolveUsers(
        ctx.db,
        events.map((e) => e.actorId),
      );
      return {
        canDecide:
          isAllowed("comment.decide", { work, grants, principal }) &&
          work.lifecycle !== "finalized",
        events: events
          .map((e) => ({ ...e, actor: users.get(e.actorId) }))
          .sort((a, b) => a.createdAt - b.createdAt),
      };
    });
  },
});
