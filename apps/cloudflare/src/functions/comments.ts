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
  loadAuthorizedWork,
  markCommentRead,
  postComment,
  replyFileIds,
  replyToThread,
  resolveMigratedFeedbackThread,
  searchMentionCandidates as searchMentionCandidatesUseCase,
  searchMentionGroups as searchMentionGroupsUseCase,
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
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { loadGroupNames, mentionViews, reactionViews } from "./threadView.ts";
import { resolveUsers } from "./users.ts";
import { object, vAnchor, vDecision, vId, vSeverity, vThreadKind } from "./validators.ts";

// apps/convex/convex/comments.ts の写し（リアクション・メンションの表示用の部品は threadView.ts）

const stringsOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export const comments = {
  /** スレッドの流れ（返信・採否・担当・持越）。削除・訂正の記録は並べず、訂正した返信には edited が付く */
  "comments:events": query({
    auth: "user",
    args: object({ threadId: vId }),
    handler: async (ctx, { threadId }) => {
      const principal = ctx.principal!;
      const thread = await ctx.db.threads.findById(threadId);
      if (!thread) throw new DomainError("forbidden", { threadId });
      const revision = await ctx.db.revisions.findById(thread.revisionId);
      if (!revision) throw new DomainError("forbidden", { threadId });
      const { work, grants } = await loadAuthorizedWork(
        ctx.db,
        principal,
        revision.workId,
        "work.view",
      );
      // 削除されたスレッドは一覧に出ないので、履歴も返さない
      const events =
        thread.deletedAt === undefined
          ? projectThreadEvents(
              await ctx.db.threads.listEvents(threadId),
              principal.userId,
              work.lifecycle,
              principal,
            )
          : [];
      const mentionsOf = (e: (typeof events)[number]) =>
        stringsOf((e.payload as { mentions?: unknown } | undefined)?.mentions);
      const groupsOf = (e: (typeof events)[number]) =>
        stringsOf((e.payload as { mentionGroupIds?: unknown } | undefined)?.mentionGroupIds);
      const groupNames = await loadGroupNames(ctx.db, events.flatMap(groupsOf));
      const users = resolveUsers(ctx.sql, [
        ...events.map((e) => e.actorId),
        ...events.flatMap(mentionsOf),
        ...events.flatMap((e) => (e.reactions ?? []).flatMap((r) => r.userIds)),
      ]);
      return {
        /** 自分がこのスレッドを最後に読んだ時刻（「ここから未読」の線の位置。読んだことが無ければ null） */
        readAt: await ctx.db.threads.readAt(principal.userId, threadId),
        subscribed: await ctx.db.threads.isSubscribed(principal.userId, threadId),
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
                  ? await listCommentFileViews(ctx.db, replyFileIds(e.payload))
                  : [],
            })),
          )
        ).sort((a, b) => a.createdAt - b.createdAt),
      };
    },
  }),

  /** 前版の未解決指摘のうち、この版へ持ち越せる候補（v1 / C5） */
  "comments:carryCandidates": query({
    auth: "user",
    args: object({ revisionId: vId }),
    handler: async (ctx, { revisionId }) => {
      const candidates = await listCarryCandidates(ctx.db, ctx.principal!, revisionId);
      const labels = new Map<string, string>();
      for (const c of candidates) {
        if (!labels.has(c.revisionId)) {
          const r = await ctx.db.revisions.findById(c.revisionId);
          labels.set(c.revisionId, r ? revisionLabel(r) : "?");
        }
      }
      const users = resolveUsers(
        ctx.sql,
        candidates.map((c) => c.authorId),
      );
      return candidates
        .map((c) => ({
          ...c,
          author: users.get(c.authorId),
          revisionLabel: labels.get(c.revisionId) ?? "?",
        }))
        .sort((a, b) => a.createdAt - b.createdAt);
    },
  }),

  /**
   * メンションの候補を「@」に続けて打った文字で探す（その制作物を見られる人のうち名前・メールが一致する人。名前順・20 人まで）。
   * 候補を取れるのも見られる人だけ。名前が当たるグループは人より前に並べる。グループの ID は「group:ID」で返し、
   * memberCount（知らせる人数）を添える
   */
  "comments:searchMentionCandidates": query({
    auth: "user",
    args: object({ workId: z.string(), text: z.string() }),
    handler: async (ctx, args) => {
      const groups = await searchMentionGroupsUseCase(ctx.db, ctx.principal!, args);
      const people = await searchMentionCandidatesUseCase(ctx.db, ctx.principal!, args);
      return [
        ...groups.map((g) => ({
          id: groupMentionToken(g.id),
          name: g.name,
          email: null,
          memberCount: g.memberCount,
        })),
        ...people.map((p) => ({ id: p.id, name: p.name, email: p.email })),
      ];
    },
  }),

  /** 新規指摘（F-06 / F-07 / A-04） */
  "comments:post": mutation({
    auth: "user",
    args: object({
      revisionId: vId,
      body: z.string(),
      /** 本文の書式（"markdown"）。無ければ平文。許す値の検査は domain（validateCommentBody） */
      bodyFormat: z.string().optional(),
      kind: vThreadKind,
      severity: vSeverity,
      anchor: vAnchor.optional(),
      requestId: z.string().optional(),
      mentions: z.array(z.string()).optional(),
      /** 添付（commentFiles:prepare → Worker で検証済みの自分の添付。10 件まで。本文が空でも添付があれば投稿できる） */
      fileIds: z.array(z.string()).optional(),
    }),
    handler: async (ctx, args) => {
      const thread = await postComment(ctx.db, ctx.principal!, args);
      return thread.id;
    },
  }),

  "comments:reply": mutation({
    auth: "user",
    args: object({
      threadId: vId,
      body: z.string(),
      bodyFormat: z.string().optional(),
      mentions: z.array(z.string()).optional(),
      fileIds: z.array(z.string()).optional(),
    }),
    handler: async (ctx, args) => {
      await replyToThread(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /** スレッドを読んだ印を付ける（パネルを開いたとき・開いている間に新しい返信が来たとき） */
  "comments:markRead": mutation({
    auth: "user",
    args: object({ threadId: vId }),
    handler: async (ctx, args) => {
      await markCommentRead(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /** スレッドを購読する・外す（購読した人は、返信していなくても返信の通知を受け取る）。見られる人だけ */
  "comments:setSubscription": mutation({
    auth: "user",
    args: object({ threadId: vId, on: z.boolean() }),
    handler: async (ctx, args) => {
      await setThreadSubscription(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /** コメント、または返信（replyEventId）へのリアクションを付ける・外す。付いた後の集計を返す。通知は出さない */
  "comments:toggleReaction": mutation({
    auth: "user",
    args: object({ threadId: vId, replyEventId: z.string().optional(), emoji: z.string() }),
    handler: async (ctx, args) => toggleCommentReaction(ctx.db, ctx.principal!, args),
  }),

  /**
   * 旧 FB のスレッドの URL（/feedback/{スレッド}）から、移し先のコメントを引く。
   * 移していない・見られない・削除された場合は null
   */
  "comments:migratedFromFeedback": query({
    auth: "user",
    args: object({ feedbackThreadId: z.string() }),
    handler: async (ctx, { feedbackThreadId }) =>
      resolveMigratedFeedbackThread(ctx.db, ctx.principal!, feedbackThreadId),
  }),

  /** 採否判断（A-07） */
  "comments:decide": mutation({
    auth: "user",
    args: object({ threadId: vId, action: vDecision, reason: z.string().optional() }),
    handler: async (ctx, args) => {
      const t = await decideThread(ctx.db, ctx.principal!, args);
      return t.resolution;
    },
  }),

  /** コメントの削除（本人、またはシステム管理者。論理削除で原文は履歴に残る） */
  "comments:remove": mutation({
    auth: "user",
    args: object({ threadId: vId }),
    handler: async (ctx, args) => {
      await deleteThread(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /** 返信の削除（本人、またはシステム管理者。論理削除で元の本文は履歴に残る）。replyEventId は events の返信の id */
  "comments:removeReply": mutation({
    auth: "user",
    args: object({ threadId: vId, replyEventId: z.string() }),
    handler: async (ctx, args) => {
      await deleteReply(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /** 指摘の対応担当者を指定／解除（v1）。採否判断権限者のみ */
  "comments:assign": mutation({
    auth: "user",
    args: object({ threadId: vId, assigneeId: z.string().nullable() }),
    handler: async (ctx, args) => {
      await assignThread(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /** 自分の指摘本文の訂正（v1）。原文は履歴イベントに残る */
  "comments:edit": mutation({
    auth: "user",
    args: object({ threadId: vId, body: z.string(), bodyFormat: z.string().optional() }),
    handler: async (ctx, args) => {
      await editThread(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /** 返信の訂正（返信した本人・校了前のみ）。訂正前の本文は reply_edited に残る */
  "comments:editReply": mutation({
    auth: "user",
    args: object({
      threadId: vId,
      replyEventId: z.string(),
      body: z.string(),
      bodyFormat: z.string().optional(),
    }),
    handler: async (ctx, args) => {
      await editReplyUseCase(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /** 前版の指摘を次版へ持ち越す（人が確認して実行。AI 提案は後続） */
  "comments:carryForward": mutation({
    auth: "user",
    args: object({ threadId: vId, targetRevisionId: vId }),
    handler: async (ctx, args) => {
      const created = await carryForwardThread(ctx.db, ctx.principal!, args);
      return created.id;
    },
  }),
} satisfies Record<string, FnDef>;
