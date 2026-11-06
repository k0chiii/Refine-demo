import {
  authorizeCommentFile,
  beginCommentFileUpload,
  beginCommentThumbUpload,
  completeCommentFileUpload,
  completeCommentThumbUpload,
  expireCommentFiles,
  failCommentFileUpload,
  prepareCommentFiles,
} from "@mf100/application";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/**
 * コメント・返信の添付。業務ルールは application / domain、ここは薄いアダプタ（FB の feedback.ts と同じ形）。
 * ID は文字列で受け、見つからない・見られないものは use case が comment_file_not_found / forbidden にする。
 */

/**
 * 添付の準備。返した fileId ごとに Hono の PUT /comment-files/:fileId で実体を、画像なら
 * PUT /comment-files/:fileId/thumb でサムネイルを送り、検証済みになったら comments.post / reply の fileIds に渡す。
 * コメントは受付中の版にだけ、返信は校了前なら可（投稿と同じ条件）。
 */
export const prepare = mutation({
  args: {
    revisionId: v.string(),
    purpose: v.union(v.literal("comment"), v.literal("reply")),
    files: v.array(
      v.object({
        fileName: v.string(),
        mimeType: v.string(),
        /** 送る実体の大きさ（再圧縮した後） */
        size: v.number(),
        originalName: v.optional(v.string()),
        /** 圧縮する前の大きさ */
        originalSize: v.optional(v.number()),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => prepareCommentFiles(createAppContext(ctx), principal, args));
  },
});

// ---------------------------------------------------------------- 実体の転送（Hono 専用）

/*
 * 公開関数にしない: 利用者が自分で「検証済み」を申告できないようにする。
 * http.ts のサービス認証付きエンドポイント（MF100_UPLOAD_SECRET）からだけ呼ばれ、
 * 利用者の JWT の主体で、添付の持ち主かを use case が確かめる。
 */

export const beginFileUpload = internalMutation({
  args: { fileId: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => beginCommentFileUpload(createAppContext(ctx), principal, args));
  },
});

export const completeFileUpload = internalMutation({
  args: { attemptId: v.string(), size: v.number(), sha256: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => completeCommentFileUpload(createAppContext(ctx), principal, args));
  },
});

export const failFileUpload = internalMutation({
  args: { attemptId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await failCommentFileUpload(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

/** サムネイルの転送の開始: 本人の、付ける前の、画像の添付に、置き場（固定キー）を知らせる */
export const beginThumbUpload = internalMutation({
  args: { fileId: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => beginCommentThumbUpload(createAppContext(ctx), principal, args));
  },
});

/** サムネイルの保存の記録（Hono が R2 に置き終えた後） */
export const completeThumbUpload = internalMutation({
  args: { fileId: v.string(), size: v.number(), mimeType: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => completeCommentThumbUpload(createAppContext(ctx), principal, args));
  },
});

/** 読み取り認可（GET /comment-files/:fileId と …/thumb）。署名付き URL は出さない */
export const authorizeFile = query({
  args: { fileId: v.string(), variant: v.union(v.literal("original"), v.literal("thumb")) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => authorizeCommentFile(createReadContext(ctx.db), principal, args));
  },
});

/** cron: コメントに付けないまま 24 時間たった添付を放置扱いにする（R2 の削除は Hono の清掃） */
export const expireFiles = internalMutation({
  args: {},
  handler: async (ctx) => (await expireCommentFiles(createAppContext(ctx), 200)).length,
});
