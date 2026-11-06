import {
  authorizeCommentFile,
  beginCommentFileUpload,
  beginCommentThumbUpload,
  completeCommentFileUpload,
  completeCommentThumbUpload,
  failCommentFileUpload,
  prepareCommentFiles,
} from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/commentFiles.ts の写し。ID は文字列で受け、見つからない・見られないものは use case が
// comment_file_not_found / forbidden にする

/**
 * 実体の転送（Worker 専用）。公開関数にしない: 利用者が自分で「検証済み」を申告できないようにする。
 * Convex の internalMutation に当たる。サービス認証（MF100_UPLOAD_SECRET）と利用者の JWT の主体で、添付の持ち主かを use case が確かめる
 */
const upload = { service: "MF100_UPLOAD_SECRET", withUser: true } as const;

export const commentFiles = {
  /**
   * 添付の準備。返した fileId ごとに PUT /comment-files/:fileId で実体を、画像なら …/thumb でサムネイルを送り、
   * 検証済みになったら comments:post / reply の fileIds に渡す。コメントは受付中の版にだけ、返信は校了前なら可
   */
  "commentFiles:prepare": mutation({
    auth: "user",
    args: object({
      revisionId: z.string(),
      purpose: z.enum(["comment", "reply"]),
      files: z.array(
        object({
          fileName: z.string(),
          mimeType: z.string(),
          /** 送る実体の大きさ（再圧縮した後） */
          size: z.number(),
          originalName: z.string().optional(),
          /** 圧縮する前の大きさ */
          originalSize: z.number().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
        }),
      ),
    }),
    handler: async (ctx, args) => prepareCommentFiles(ctx.db, ctx.principal!, args),
  }),

  "commentFiles:beginFileUpload": mutation({
    auth: upload,
    args: object({ fileId: z.string() }),
    handler: async (ctx, args) => beginCommentFileUpload(ctx.db, ctx.principal!, args),
  }),

  "commentFiles:completeFileUpload": mutation({
    auth: upload,
    args: object({ attemptId: z.string(), size: z.number(), sha256: z.string() }),
    handler: async (ctx, args) => completeCommentFileUpload(ctx.db, ctx.principal!, args),
  }),

  "commentFiles:failFileUpload": mutation({
    auth: upload,
    args: object({ attemptId: z.string(), message: z.string() }),
    handler: async (ctx, args) => {
      await failCommentFileUpload(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /** サムネイルの転送の開始: 本人の、付ける前の、画像の添付に、置き場（固定キー）を知らせる */
  "commentFiles:beginThumbUpload": mutation({
    auth: upload,
    args: object({ fileId: z.string() }),
    handler: async (ctx, args) => beginCommentThumbUpload(ctx.db, ctx.principal!, args),
  }),

  /** サムネイルの保存の記録（R2 に置き終えた後） */
  "commentFiles:completeThumbUpload": mutation({
    auth: upload,
    args: object({ fileId: z.string(), size: z.number(), mimeType: z.string() }),
    handler: async (ctx, args) => completeCommentThumbUpload(ctx.db, ctx.principal!, args),
  }),

  /** 読み取り認可（GET /comment-files/:fileId と …/thumb）。署名付き URL は出さない */
  "commentFiles:authorizeFile": query({
    auth: "user",
    args: object({ fileId: z.string(), variant: z.enum(["original", "thumb"]) }),
    handler: async (ctx, args) => authorizeCommentFile(ctx.db, ctx.principal!, args),
  }),
} satisfies Record<string, FnDef>;
