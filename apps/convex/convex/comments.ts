import {
  assignThread,
  carryForwardThread,
  decideThread,
  editThread,
  listCarryCandidates,
  searchMentionCandidates as searchMentionCandidatesUseCase,
  postComment,
  replyToThread,
} from "@mf100/application";
import { DomainError, isAllowed, revisionLabel } from "@mf100/domain";
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
    mentions: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const thread = await postComment(createAppContext(ctx), principal, args);
      return thread.id;
    });
  },
});

export const reply = mutation({
  args: {
    threadId: v.id("commentThreads"),
    body: v.string(),
    mentions: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await replyToThread(createAppContext(ctx), principal, args);
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
      const t = await decideThread(createAppContext(ctx), principal, args);
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
      const mentionsOf = (e: (typeof events)[number]): string[] => {
        const m = (e.payload as { mentions?: unknown } | undefined)?.mentions;
        return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : [];
      };
      const users = await resolveUsers(ctx.db, [
        ...events.map((e) => e.actorId),
        ...events.flatMap(mentionsOf),
      ]);
      return {
        canDecide:
          isAllowed("comment.decide", { work, grants, principal }) &&
          work.lifecycle !== "finalized",
        events: events
          .map((e) => ({
            ...e,
            actor: users.get(e.actorId),
            mentionUsers: mentionsOf(e).flatMap((id) => {
              const u = users.get(id);
              return u ? [u] : [];
            }),
          }))
          .sort((a, b) => a.createdAt - b.createdAt),
      };
    });
  },
});

/** 指摘の対応担当者を指定／解除（v1）。採否判断権限者のみ。 */
export const assign = mutation({
  args: { threadId: v.id("commentThreads"), assigneeId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await assignThread(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

/** 自分の指摘本文の訂正（v1）。原文は履歴イベントに残る。 */
export const edit = mutation({
  args: { threadId: v.id("commentThreads"), body: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await editThread(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

/** 前版の未解決指摘のうち、この版へ持ち越せる候補（v1 / C5）。 */
export const carryCandidates = query({
  args: { revisionId: v.id("revisions") },
  handler: async (ctx, { revisionId }) => {
    const { principal } = await requireUser(ctx);
    const app = createReadContext(ctx.db);
    return runUseCase(async () => {
      const candidates = await listCarryCandidates(app, principal, revisionId);
      const revisions = new Map<string, string>();
      for (const c of candidates) {
        if (!revisions.has(c.revisionId)) {
          const r = await app.revisions.findById(c.revisionId);
          revisions.set(c.revisionId, r ? revisionLabel(r) : "?");
        }
      }
      const users = await resolveUsers(
        ctx.db,
        candidates.map((c) => c.authorId),
      );
      return candidates
        .map((c) => ({
          ...c,
          author: users.get(c.authorId),
          revisionLabel: revisions.get(c.revisionId) ?? "?",
        }))
        .sort((a, b) => a.createdAt - b.createdAt);
    });
  },
});

/** 前版の指摘を次版へ持ち越す（人が確認して実行。AI 提案は後続）。 */
export const carryForward = mutation({
  args: { threadId: v.id("commentThreads"), targetRevisionId: v.id("revisions") },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const created = await carryForwardThread(createAppContext(ctx), principal, args);
      return created.id;
    });
  },
});

/**
 * メンションの候補を「@」に続けて打った文字で探す（その制作物を見られる人のうち名前・メールが一致する人。名前順・20 人まで）。
 * 候補を取れるのも見られる人だけ。画面は候補の一覧を丸ごと購読せず、打っている間だけこの検索を購読する（docs/UI_M3E.md §60）
 */
export const searchMentionCandidates = query({
  args: { workId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() =>
      searchMentionCandidatesUseCase(createReadContext(ctx.db), principal, args),
    );
  },
});
