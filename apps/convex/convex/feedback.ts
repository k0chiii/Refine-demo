import {
  authorizeFeedbackFile,
  createFeedbackThread,
  deleteFeedbackPost,
  editFeedbackPost,
  beginFeedbackFileUpload,
  completeFeedbackFileUpload,
  expireFeedbackFiles,
  failFeedbackFileUpload,
  getFeedbackThread,
  listFeedbackMentionCandidates,
  listFeedbackThreads,
  markFeedbackRead,
  postFeedback,
  prepareFeedbackFiles,
  renameFeedbackThread,
  searchFeedbackPeople,
  toggleFeedbackReaction,
} from "@mf100/application";
import { isDomainError } from "@mf100/domain";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { vFeedbackTemplateId } from "./lib/validators.ts";
import { anchorValidator } from "./schema.ts";

/**
 * 制作のフィードバック（表現の議論）。業務ルールは application / domain、ここは薄いアダプタ。
 * ID は文字列で受け、見つからない・見られないものは use case が feedback_not_found / forbidden にする
 * （v.id で受けると、形の違う ID で表の存在が分かってしまうのを避ける意味もある）。
 */

const postFields = {
  body: v.string(),
  mentions: v.optional(v.array(v.string())),
  fileIds: v.optional(v.array(v.string())),
  template: v.optional(vFeedbackTemplateId),
};

/** スレッドの一覧（最後の投稿が新しい順。見られる制作物のものだけ） */
export const listThreads = query({
  args: {
    workId: v.optional(v.string()),
    revisionId: v.optional(v.string()),
    mine: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => listFeedbackThreads(createReadContext(ctx.db), principal, args));
  },
});

/** スレッドを開く。無い・見られないときは null（存在を漏らさない） */
export const getThread = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      try {
        return await getFeedbackThread(createReadContext(ctx.db), principal, threadId);
      } catch (e) {
        if (isDomainError(e) && (e.code === "feedback_not_found" || e.code === "forbidden"))
          return null;
        throw e;
      }
    });
  },
});

/** メンションの候補（画面で前もって読み、手元で絞る）。自分は除く・名前順 */
export const mentionCandidates = query({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() =>
      listFeedbackMentionCandidates(createReadContext(ctx.db), principal, workId),
    );
  },
});

/** メンションの候補を名前・メールで探す（10 人まで） */
export const searchPeople = query({
  args: { workId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => searchFeedbackPeople(createReadContext(ctx.db), principal, args));
  },
});

/** スレッドを立てる（最初の投稿も作る）。スレッドの ID を返す */
export const createThread = mutation({
  args: {
    workId: v.string(),
    title: v.optional(v.string()),
    revisionId: v.optional(v.string()),
    anchor: v.optional(anchorValidator),
    ...postFields,
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => createFeedbackThread(createAppContext(ctx.db), principal, args));
  },
});

/** スレッドに投稿する。投稿の ID を返す */
export const post = mutation({
  args: { threadId: v.string(), ...postFields },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => postFeedback(createAppContext(ctx.db), principal, args));
  },
});

export const editPost = mutation({
  args: { postId: v.string(), body: v.string(), mentions: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await editFeedbackPost(createAppContext(ctx.db), principal, args);
      return null;
    });
  },
});

export const deletePost = mutation({
  args: { postId: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await deleteFeedbackPost(createAppContext(ctx.db), principal, args);
      return null;
    });
  },
});

/** リアクションを付ける・外す。付いた後の集計を返す */
export const toggleReaction = mutation({
  args: { postId: v.string(), emoji: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => toggleFeedbackReaction(createAppContext(ctx.db), principal, args));
  },
});

export const renameThread = mutation({
  args: { threadId: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await renameFeedbackThread(createAppContext(ctx.db), principal, args);
      return null;
    });
  },
});

export const markRead = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await markFeedbackRead(createAppContext(ctx.db), principal, threadId);
      return null;
    });
  },
});

/** 添付の準備。返した fileId ごとに Hono の PUT /feedback/files/:fileId で実体を送る */
export const prepareFiles = mutation({
  args: {
    workId: v.string(),
    files: v.array(v.object({ fileName: v.string(), mimeType: v.string(), size: v.number() })),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => prepareFeedbackFiles(createAppContext(ctx.db), principal, args));
  },
});

// ---------------------------------------------------------------- 実体の転送（Hono 専用）

/*
 * 公開関数にしない: 利用者が自分で「検証済み」を申告できないようにする。
 * http.ts のサービス認証付きエンドポイント（MF100_UPLOAD_SECRET）からだけ呼ばれ、
 * 利用者の JWT の主体で、添付の持ち主かを use case が確かめる。
 */

/** 転送の開始: 本人の、投稿に付ける前の、未検証の添付に、この試行だけの R2 キーを払い出す */
export const beginFileUpload = internalMutation({
  args: { fileId: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => beginFeedbackFileUpload(createAppContext(ctx.db), principal, args));
  },
});

/** 検証完了: 添付がまだ受付中・未検証なら、この試行を原子的に採用する */
export const completeFileUpload = internalMutation({
  args: { attemptId: v.string(), size: v.number(), sha256: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => completeFeedbackFileUpload(createAppContext(ctx.db), principal, args));
  },
});

/** 転送の失敗（Hono の補償）: 試行を破棄する */
export const failFileUpload = internalMutation({
  args: { attemptId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await failFeedbackFileUpload(createAppContext(ctx.db), principal, args);
      return null;
    });
  },
});

/** 読み取り認可（GET /feedback/files/:fileId）。署名付き URL は出さない */
export const authorizeFile = query({
  args: { fileId: v.string() },
  handler: async (ctx, { fileId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => authorizeFeedbackFile(createReadContext(ctx.db), principal, fileId));
  },
});

/** cron: 投稿に付けないまま 24 時間たった添付を放置扱いにする（R2 の削除は Hono の清掃） */
export const expireFiles = internalMutation({
  args: {},
  handler: async (ctx) => (await expireFeedbackFiles(createAppContext(ctx.db), 200)).length,
});
