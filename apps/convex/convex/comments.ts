import {
  assignThread,
  carryForwardThread,
  decideThread,
  deleteReply,
  deleteThread,
  editReply as editReplyUseCase,
  editThread,
  listCarryCandidates,
  listCommentFileViews,
  markCommentRead,
  replyFileIds,
  resolveMigratedFeedbackThread,
  searchMentionCandidates as searchMentionCandidatesUseCase,
  searchMentionGroups as searchMentionGroupsUseCase,
  postComment,
  replyToThread,
  setThreadSubscription,
  toggleCommentReaction,
} from "@mf100/application";
import {
  DomainError,
  groupMentionToken,
  isAllowed,
  projectThreadEvents,
  revisionLabel,
} from "@mf100/domain";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { reactionViews, reactorIds } from "./lib/reactions.ts";
import { loadGroupNames, mentionViews } from "./lib/threadActivity.ts";
import { resolveUsers } from "./lib/users.ts";
import { vDecision, vSeverity, vThreadKind } from "./lib/validators.ts";
import { anchorValidator } from "./schema.ts";
import { loadAuthorizedWork } from "@mf100/application";

/** 新規指摘（F-06 / F-07 / A-04）。 */
export const post = mutation({
  args: {
    revisionId: v.id("revisions"),
    body: v.string(),
    /** 本文の書式（"markdown"）。無ければ平文。許す値の検査は domain（validateCommentBody） */
    bodyFormat: v.optional(v.string()),
    kind: vThreadKind,
    severity: vSeverity,
    anchor: v.optional(anchorValidator),
    requestId: v.optional(v.string()),
    mentions: v.optional(v.array(v.string())),
    /** 添付（commentFiles.prepare → Hono で検証済みの自分の添付。10 件まで。本文が空でも添付があれば投稿できる） */
    fileIds: v.optional(v.array(v.string())),
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
    bodyFormat: v.optional(v.string()),
    mentions: v.optional(v.array(v.string())),
    fileIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await replyToThread(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

/** スレッドを読んだ印を付ける（パネルを開いたとき・開いている間に新しい返信が来たとき）。 */
export const markRead = mutation({
  args: { threadId: v.id("commentThreads") },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await markCommentRead(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

/** スレッドを購読する・外す（購読した人は、返信していなくても返信の通知を受け取る）。見られる人だけ */
export const setSubscription = mutation({
  args: { threadId: v.id("commentThreads"), on: v.boolean() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await setThreadSubscription(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

/**
 * コメント、または返信（replyEventId）へのリアクションを付ける・外す。付いた後の集計を返す。
 * 付けられる人は返信と同じ。通知は出さない（FB と同じ）。
 */
export const toggleReaction = mutation({
  args: {
    threadId: v.id("commentThreads"),
    replyEventId: v.optional(v.string()),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => toggleCommentReaction(createAppContext(ctx), principal, args));
  },
});

/**
 * 旧 FB のスレッドの URL（/feedback/{スレッド}）から、移し先のコメントを引く。FB をコメントへ移した後も、
 * 古いリンク・ブックマークから辿れるようにする。移していない・見られない・削除された場合は null
 */
export const migratedFromFeedback = query({
  args: { feedbackThreadId: v.string() },
  handler: async (ctx, { feedbackThreadId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() =>
      resolveMigratedFeedbackThread(createReadContext(ctx.db), principal, feedbackThreadId),
    );
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

/** スレッドの流れ（返信・採否・担当・持越）。削除・訂正の記録は並べず、訂正した返信には edited が付く。 */
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
      // 削除されたスレッドは一覧に出ないので、履歴も返さない
      const events =
        thread.deletedAt === undefined
          ? projectThreadEvents(
              await app.threads.listEvents(threadId),
              principal.userId,
              work.lifecycle,
              principal,
            )
          : [];
      const mentionsOf = (e: (typeof events)[number]): string[] => {
        const m = (e.payload as { mentions?: unknown } | undefined)?.mentions;
        return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : [];
      };
      const groupsOf = (e: (typeof events)[number]): string[] => {
        const m = (e.payload as { mentionGroupIds?: unknown } | undefined)?.mentionGroupIds;
        return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : [];
      };
      const groupNames = await loadGroupNames(ctx.db, events.flatMap(groupsOf));
      const users = await resolveUsers(ctx.db, [
        ...events.map((e) => e.actorId),
        ...events.flatMap(mentionsOf),
        ...events.flatMap((e) => reactorIds(e.reactions)),
      ]);
      return {
        /** 自分がこのスレッドを最後に読んだ時刻（「ここから未読」の線の位置。読んだことが無ければ null） */
        readAt: await app.threads.readAt(principal.userId, threadId),
        subscribed: await app.threads.isSubscribed(principal.userId, threadId),
        canDecide:
          thread.deletedAt === undefined &&
          isAllowed("comment.decide", { work, grants, principal }) &&
          work.lifecycle !== "finalized",
        events: (
          await Promise.all(
            events.map(async (e) => ({
              ...e,
              actor: users.get(e.actorId),
              reactions: reactionViews(e.reactions, principal.userId, users),
              mentionUsers: mentionViews(mentionsOf(e), groupsOf(e), users, groupNames),
              /** 返信の添付（検証済みで削除されていないもの） */
              files:
                e.eventType === "replied"
                  ? await listCommentFileViews(app, replyFileIds(e.payload))
                  : [],
            })),
          )
        ).sort((a, b) => a.createdAt - b.createdAt),
      };
    });
  },
});

/** コメントの削除（本人、またはシステム管理者。論理削除で原文は履歴に残る）。 */
export const remove = mutation({
  args: { threadId: v.id("commentThreads") },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await deleteThread(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

/** 返信の削除（本人、またはシステム管理者。論理削除で元の本文は履歴に残る）。replyEventId は events の返信の id。 */
export const removeReply = mutation({
  args: { threadId: v.id("commentThreads"), replyEventId: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await deleteReply(createAppContext(ctx), principal, args);
      return null;
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
  args: {
    threadId: v.id("commentThreads"),
    body: v.string(),
    bodyFormat: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await editThread(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

/** 返信の訂正（返信した本人・校了前のみ）。訂正前の本文は reply_edited に残り、流れには「編集済み」の印だけが出る。 */
export const editReply = mutation({
  args: {
    threadId: v.id("commentThreads"),
    replyEventId: v.string(),
    body: v.string(),
    bodyFormat: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await editReplyUseCase(createAppContext(ctx), principal, args);
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
 * 名前が当たるグループ（利用者指示 2026-10-21）は人より前に並べる。グループの ID は「group:ID」で返し、memberCount（知らせる人数）を添える
 */
export const searchMentionCandidates = query({
  args: { workId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const app = createReadContext(ctx.db);
      const groups = await searchMentionGroupsUseCase(app, principal, args);
      const people = await searchMentionCandidatesUseCase(app, principal, args);
      return [
        ...groups.map((g) => ({
          id: groupMentionToken(g.id),
          name: g.name,
          email: null,
          memberCount: g.memberCount,
        })),
        ...people.map((p) => ({ id: p.id, name: p.name, email: p.email })),
      ];
    });
  },
});
