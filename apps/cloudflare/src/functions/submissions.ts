import {
  ATTEMPT_ORPHAN_PREFIX,
  COMMENT_ORPHAN_PREFIX,
  beginItemUpload,
  completeItemUpload,
  confirmSubmission,
  failItemUpload,
  listOrphanAttemptObjects,
  listOrphanCommentObjects,
  listOrphanUploadObjects,
  markAttemptObjectsPurged,
  markCommentObjectsPurged,
  markUploadObjectsPurged,
  prepareSubmission,
  resetItem,
  resumeItemUpload,
  voidRevisionUseCase,
} from "@mf100/application";
import { DomainError } from "@mf100/domain";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import {
  object,
  vArtifactOrigin,
  vArtifactRole,
  vArtifactType,
  vCheckType,
  vFigmaImportMeta,
  vId,
  vRevisionDeclarations,
  vRevisionKind,
} from "./validators.ts";

// apps/convex/convex/submissions.ts の写し（expireSessions は cron の単位で、src/db.ts の runJobs が持つ）

/**
 * 実体の転送（Worker 専用）。Convex では internalMutation を http.ts が引く（X-MF100-Service-Key + 利用者の JWT）。
 * 公開関数にしない: 利用者が自分で「検証済み」を申告して版を確定させられないようにする。項目の持ち主・提出権限は use case が確かめる
 */
const upload = { service: "MF100_UPLOAD_SECRET", withUser: true } as const;

/**
 * R2 の清掃（apps/api の cron）。Convex では internalMutation を http.ts の /internal/upload-orphans が引く（Bearer MF100_CLEANUP_SECRET）。
 * ここでは同じ秘密で /f/submissions:listOrphanObjects などを呼ぶ。利用者は要らない（withUser: false）
 */
const cleanup = { service: "MF100_CLEANUP_SECRET", withUser: false } as const;

/** 1 回の一覧・記録の上限（Convex と同じ） */
const CLEANUP_LIMIT = 500;

/** 旧 FB の添付の清掃の印。FB は廃止し、移した添付は同じ実体を指すので、記録は何もせず読み捨てる */
const LEGACY_FEEDBACK_ORPHAN_PREFIX = "feedback:";

export const submissions = {
  /** 版提出の準備（U-04 / F-04）。Revision はまだ作らない */
  "submissions:prepare": mutation({
    auth: "user",
    args: object({
      workId: vId,
      kind: vRevisionKind,
      reviewType: z.string(),
      deadlineAt: z.number(),
      reviewUrgent: z.boolean().optional(),
      changeSummary: z.string(),
      focusNotes: z.string(),
      items: z.array(
        object({
          fileName: z.string(),
          mimeType: z.string(),
          type: vArtifactType,
          role: vArtifactRole,
          declaredSize: z.number().optional(),
          externalUrl: z.string().optional(),
          origin: vArtifactOrigin.optional(),
        }),
      ),
      requiredChecks: z
        .array(object({ type: vCheckType, label: z.string(), assigneeId: z.string().optional() }))
        .optional(),
      postSnapshot: z.string().optional(),
      /** 提出時の申告（写真・めい・指針外の色の使用）と本人が確認した項目（Notion の版 DB に揃えた） */
      declarations: vRevisionDeclarations.optional(),
      selfChecks: z.array(z.string()).optional(),
      requestId: z.string().optional(),
    }),
    handler: async (ctx, args) => {
      const { session, items } = await prepareSubmission(ctx.db, ctx.principal!, args);
      return {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        items: items.map((i) => ({
          id: i.id,
          fileName: i.fileName,
          // 実体を送る項目か（外部リンクは null）。実際のキーは転送の試行ごとに払い出す
          keyPrefix: i.keyPrefix ?? null,
          status: i.status,
        })),
      };
    },
  }),

  /** 転送の開始: この試行だけが書き込む R2 キーを払い出す（PUT の前） */
  "submissions:beginUpload": mutation({
    auth: upload,
    args: object({ itemId: z.string() }),
    handler: async (ctx, args) => beginItemUpload(ctx.db, ctx.principal!, args),
  }),

  "submissions:resumeUpload": mutation({
    auth: upload,
    args: object({ attemptId: z.string() }),
    handler: async (ctx, args) => resumeItemUpload(ctx.db, ctx.principal!, args),
  }),

  /** 検証完了: R2 が sha256 を確かめた試行を、項目がまだ受付中・未検証なら原子的に採用する */
  "submissions:completeUpload": mutation({
    auth: upload,
    args: object({
      attemptId: z.string(),
      size: z.number(),
      sha256: z.string(),
      pageCount: z.number().optional(),
      /** .ai の先頭を見て PDF の見出しがあったか（.ai のときだけ） */
      pdfCompatible: z.boolean().optional(),
      /** Figma から取り込んだとき（/figma/import）に Figma の応答から埋める値 */
      figma: vFigmaImportMeta.optional(),
    }),
    handler: async (ctx, args) => {
      const item = await completeItemUpload(ctx.db, ctx.principal!, args);
      return { status: item.status, failureMessage: item.failureMessage ?? null };
    },
  }),

  /** 転送の失敗（補償）: 試行を破棄する。項目は受付中・未検証のときだけ failed */
  "submissions:failUpload": mutation({
    auth: upload,
    args: object({ attemptId: z.string(), message: z.string() }),
    handler: async (ctx, args) => {
      await failItemUpload(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  "submissions:reset": mutation({
    auth: "user",
    args: object({ itemId: vId }),
    handler: async (ctx, args) => {
      await resetItem(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  /** 提出確定（D1 / A-16 / A-17） */
  "submissions:confirm": mutation({
    auth: "user",
    args: object({
      sessionId: vId,
      requestId: z.string().optional(),
      expectedWorkVersion: z.number().optional(),
    }),
    handler: async (ctx, args) => {
      const { revision, supersededRevisionId } = await confirmSubmission(
        ctx.db,
        ctx.principal!,
        args,
      );
      return {
        revisionId: revision.id,
        sequence: revision.sequence,
        kind: revision.kind,
        supersededRevisionId,
      };
    },
  }),

  /** 誤提出した版の無効化（v1）。受付中の版のみ。理由必須。以後の版番号は欠番にならない */
  "submissions:voidRevision": mutation({
    auth: "user",
    args: object({ revisionId: vId, reason: z.string() }),
    handler: async (ctx, args) => {
      const r = await voidRevisionUseCase(ctx.db, ctx.principal!, args);
      return { reviewState: r.reviewState };
    },
  }),

  /**
   * 清掃: R2 に実体が残っている孤立の一覧。版の提出物（abandoned セッション）→ コメントの添付（itemId は `comment:{添付 ID}`、
   * サムネイルは extraObjectKeys）→ 採用されなかった転送の試行（`attempt:{試行 ID}`）の順に、上限まで詰める。
   * 一覧のついでに、消す実体が無いものを清掃済みにするので mutation
   */
  "submissions:listOrphanObjects": mutation({
    auth: cleanup,
    args: object({ limit: z.number().optional() }),
    handler: async (ctx, { limit }) => {
      const max = Math.min(limit ?? 100, CLEANUP_LIMIT);
      const out: Array<{ itemId: string; objectKey: string; extraObjectKeys?: string[] }> =
        await listOrphanUploadObjects(ctx.db, max);
      if (out.length < max) out.push(...(await listOrphanCommentObjects(ctx.db, max - out.length)));
      if (out.length < max) out.push(...(await listOrphanAttemptObjects(ctx.db, max - out.length)));
      return out;
    },
  }),

  /** 清掃: R2 から消した印を付ける（冪等）。`comment:` はコメントの添付、`attempt:` は転送の試行、`feedback:` は読み捨て、ほかは版の提出物 */
  "submissions:markObjectsPurged": mutation({
    auth: cleanup,
    args: object({ itemIds: z.array(z.string()) }),
    handler: async (ctx, { itemIds }) => {
      const ids = itemIds.slice(0, CLEANUP_LIMIT);
      const withPrefix = (prefix: string) =>
        ids.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
      const uploads = ids.filter(
        (id) =>
          !id.startsWith(LEGACY_FEEDBACK_ORPHAN_PREFIX) &&
          !id.startsWith(COMMENT_ORPHAN_PREFIX) &&
          !id.startsWith(ATTEMPT_ORPHAN_PREFIX),
      );
      return (
        (await markUploadObjectsPurged(ctx.db, uploads)) +
        (await markCommentObjectsPurged(ctx.db, withPrefix(COMMENT_ORPHAN_PREFIX))) +
        (await markAttemptObjectsPurged(ctx.db, withPrefix(ATTEMPT_ORPHAN_PREFIX)))
      );
    },
  }),

  /**
   * 自分のアップロードセッションの状態（U-04 の進捗表示）。本人のセッションだけ（他人の・無いものは forbidden）。
   * 戻りは doc そのもの（id を持つ。Convex の _id / _creationTime に当たる）
   */
  "submissions:get": query({
    auth: "user",
    args: object({ sessionId: vId }),
    handler: async (ctx, { sessionId }) => {
      const session = await ctx.db.uploads.findById(sessionId);
      if (!session || session.submittedBy !== ctx.principal!.userId)
        throw new DomainError("forbidden", { sessionId });
      return { session, items: await ctx.db.uploads.listItems(sessionId) };
    },
  }),
} satisfies Record<string, FnDef>;
