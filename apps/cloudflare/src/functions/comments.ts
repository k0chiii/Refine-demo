import {
  assignThread,
  carryForwardThread,
  decideThread,
  deleteReply,
  deleteThread,
  editReply as editReplyUseCase,
  editThread,
  markCommentRead,
  postComment,
  replyToThread,
  resolveMigratedFeedbackThread,
  setThreadSubscription,
  toggleCommentReaction,
} from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object, vAnchor, vDecision, vId, vSeverity, vThreadKind } from "./validators.ts";

// apps/convex/convex/comments.ts の写し（use case の薄い包みだけ。events / carryCandidates / searchMentionCandidates は画面向けの読みで別の単位）

export const comments = {
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
