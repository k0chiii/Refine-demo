import {
  ATTEMPT_ORPHAN_PREFIX,
  FEEDBACK_ORPHAN_PREFIX,
  beginItemUpload,
  completeItemUpload,
  confirmSubmission,
  expireUploadSessions,
  failItemUpload,
  listOrphanAttemptObjects,
  listOrphanFeedbackObjects,
  listOrphanUploadObjects,
  markAttemptObjectsPurged,
  markFeedbackObjectsPurged,
  markUploadObjectsPurged,
  prepareSubmission,
  resetItem,
  voidRevisionUseCase,
} from "@mf100/application";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { createAppContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import {
  vArtifactOrigin,
  vArtifactRole,
  vArtifactType,
  vCheckType,
  vFigmaImportMeta,
  vRevisionDeclarations,
  vRevisionKind,
} from "./lib/validators.ts";
import { DomainError } from "@mf100/domain";

/** 版提出の準備（U-04 / F-04）。Revision はまだ作らない。 */
export const prepare = mutation({
  args: {
    workId: v.id("works"),
    kind: vRevisionKind,
    reviewType: v.string(),
    deadlineAt: v.number(),
    changeSummary: v.string(),
    focusNotes: v.string(),
    items: v.array(
      v.object({
        fileName: v.string(),
        mimeType: v.string(),
        type: vArtifactType,
        role: vArtifactRole,
        declaredSize: v.optional(v.number()),
        externalUrl: v.optional(v.string()),
        origin: v.optional(vArtifactOrigin),
      }),
    ),
    requiredChecks: v.optional(
      v.array(
        v.object({ type: vCheckType, label: v.string(), assigneeId: v.optional(v.string()) }),
      ),
    ),
    postSnapshot: v.optional(v.string()),
    /** 提出時の申告（写真・めい・指針外の色の使用）と本人が確認した項目（Notion の版 DB に揃えた） */
    declarations: v.optional(vRevisionDeclarations),
    selfChecks: v.optional(v.array(v.string())),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const { session, items } = await prepareSubmission(createAppContext(ctx), principal, args);
      return {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        items: items.map((i) => ({
          id: i.id,
          fileName: i.fileName,
          // 実体を送る項目か（外部リンクは null）。実際のキーは転送の試行ごとに Hono へ払い出す
          keyPrefix: i.keyPrefix ?? null,
          status: i.status,
        })),
      };
    });
  },
});

/*
 * 実体の転送（Hono 専用）。公開関数にしない: 利用者が自分で「検証済み」を申告して版を確定させられないようにする。
 * http.ts のサービス認証付きエンドポイント（MF100_UPLOAD_SECRET）からだけ呼ばれ、
 * 利用者の JWT（Hono も検証済み）の主体で、項目の持ち主・提出権限を use case が確かめる。
 */

/** 転送の開始: この試行だけが書き込む R2 キーを払い出す（PUT の前） */
export const beginUpload = internalMutation({
  args: { itemId: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => beginItemUpload(createAppContext(ctx), principal, args));
  },
});

/** 検証完了: R2 が sha256 を確かめた試行を、項目がまだ受付中・未検証なら原子的に採用する */
export const completeUpload = internalMutation({
  args: {
    attemptId: v.string(),
    size: v.number(),
    sha256: v.string(),
    pageCount: v.optional(v.number()),
    /** Figma から取り込んだとき（Hono の /figma/import）に Figma の応答から埋める値 */
    figma: v.optional(vFigmaImportMeta),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const item = await completeItemUpload(createAppContext(ctx), principal, args);
      return { status: item.status, failureMessage: item.failureMessage ?? null };
    });
  },
});

/** 転送の失敗（Hono の補償）: 試行を破棄する。項目は受付中・未検証のときだけ failed */
export const failUpload = internalMutation({
  args: { attemptId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await failItemUpload(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

export const reset = mutation({
  args: { itemId: v.id("uploadItems") },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await resetItem(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

/** 提出確定（D1 / A-16 / A-17）。 */
export const confirm = mutation({
  args: {
    sessionId: v.id("uploadSessions"),
    requestId: v.optional(v.string()),
    expectedWorkVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const { revision, supersededRevisionId } = await confirmSubmission(
        createAppContext(ctx),
        principal,
        args,
      );
      return {
        revisionId: revision.id,
        sequence: revision.sequence,
        kind: revision.kind,
        supersededRevisionId,
      };
    });
  },
});

/** 自分のアップロードセッションの状態（U-04 の進捗表示）。 */
export const get = query({
  args: { sessionId: v.id("uploadSessions") },
  handler: async (ctx, { sessionId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const session = await ctx.db.get("uploadSessions", sessionId);
      if (!session || session.submittedBy !== principal.userId)
        throw new DomainError("forbidden", { sessionId });
      const items = await ctx.db
        .query("uploadItems")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect();
      return { session, items };
    });
  },
});

/** 誤提出した版の無効化（v1）。受付中の版のみ。理由必須。以後の版番号は欠番にならない。 */
export const voidRevision = mutation({
  args: { revisionId: v.id("revisions"), reason: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const r = await voidRevisionUseCase(createAppContext(ctx), principal, args);
      return { reviewState: r.reviewState };
    });
  },
});

/** cron: 期限切れの open なアップロードセッションを abandoned にする（D14 の清掃）。 */
export const expireSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ids = await expireUploadSessions(createAppContext(ctx), 100);
    return ids.length;
  },
});

/**
 * 清掃: abandoned セッションの未削除オブジェクト一覧（Hono の cron が http.ts 経由で取得）。
 * 放置されたフィードバックの添付（itemId は "feedback:{添付 ID}"）と、採用されなかった転送の試行
 * （itemId は "attempt:{試行 ID}"）も同じ一覧に載せる。Hono には不透明な ID。
 */
export const listOrphanObjects = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const app = createAppContext(ctx);
    const max = Math.min(limit ?? 100, 500);
    const out = await listOrphanUploadObjects(app, max);
    if (out.length < max) out.push(...(await listOrphanFeedbackObjects(app, max - out.length)));
    if (out.length < max) out.push(...(await listOrphanAttemptObjects(app, max - out.length)));
    return out;
  },
});

/**
 * 清掃: R2 から削除済みの項目を記録（冪等）。"feedback:" で始まるものはフィードバックの添付、
 * "attempt:" で始まるものは採用されなかった転送の試行。
 */
export const markObjectsPurged = internalMutation({
  args: { itemIds: v.array(v.string()) },
  handler: async (ctx, { itemIds }) => {
    const app = createAppContext(ctx);
    const ids = itemIds.slice(0, 500);
    const withPrefix = (prefix: string) =>
      ids.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
    const uploads = ids.filter(
      (id) => !id.startsWith(FEEDBACK_ORPHAN_PREFIX) && !id.startsWith(ATTEMPT_ORPHAN_PREFIX),
    );
    return (
      (await markUploadObjectsPurged(app, uploads)) +
      (await markFeedbackObjectsPurged(app, withPrefix(FEEDBACK_ORPHAN_PREFIX))) +
      (await markAttemptObjectsPurged(app, withPrefix(ATTEMPT_ORPHAN_PREFIX)))
    );
  },
});
