import {
  FEEDBACK_ORPHAN_PREFIX,
  listOrphanFeedbackObjects,
  markFeedbackObjectsPurged,
  confirmSubmission,
  expireUploadSessions,
  listOrphanUploadObjects,
  markUploadObjectsPurged,
  prepareSubmission,
  recordItemFailed,
  recordItemVerified,
  resetItem,
  voidRevisionUseCase,
} from "@mf100/application";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { createAppContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { vArtifactRole, vArtifactType, vCheckType, vRevisionKind } from "./lib/validators.ts";
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
      }),
    ),
    requiredChecks: v.optional(
      v.array(
        v.object({ type: vCheckType, label: v.string(), assigneeId: v.optional(v.string()) }),
      ),
    ),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const { session, items } = await prepareSubmission(createAppContext(ctx.db), principal, args);
      return {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        items: items.map((i) => ({
          id: i.id,
          fileName: i.fileName,
          objectKey: i.objectKey ?? null,
          status: i.status,
        })),
      };
    });
  },
});

/** Hono（R2 実体検証後）から利用者のトークンで呼ばれる。 */
export const markVerified = mutation({
  args: {
    itemId: v.id("uploadItems"),
    size: v.number(),
    sha256: v.string(),
    pageCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const item = await recordItemVerified(createAppContext(ctx.db), principal, args);
      return { status: item.status, failureMessage: item.failureMessage ?? null };
    });
  },
});

export const markFailed = mutation({
  args: { itemId: v.id("uploadItems"), message: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await recordItemFailed(createAppContext(ctx.db), principal, args);
      return null;
    });
  },
});

export const reset = mutation({
  args: { itemId: v.id("uploadItems") },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await resetItem(createAppContext(ctx.db), principal, args);
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
        createAppContext(ctx.db),
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

/**
 * Hono が PUT 受付前に呼ぶ: 呼出し主体が所有する open なセッションの、まだ検証されていない項目だけを返す。
 * 他人の項目・確定済みセッションは存在を漏らさず forbidden。
 */
export const itemForUpload = query({
  args: { itemId: v.id("uploadItems") },
  handler: async (ctx, { itemId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const item = await ctx.db.get("uploadItems", itemId);
      if (!item) throw new DomainError("upload_item_not_found", { itemId });
      const session = await ctx.db.get("uploadSessions", item.sessionId);
      if (!session || session.submittedBy !== principal.userId)
        throw new DomainError("upload_item_not_found", { itemId });
      if (session.state !== "open")
        throw new DomainError("upload_session_not_open", {
          sessionId: session._id,
          state: session.state,
        });
      if (Date.now() >= session.expiresAt)
        throw new DomainError("upload_session_expired", { sessionId: session._id });
      if (!item.objectKey)
        throw new DomainError("upload_item_invalid_state", { itemId, reason: "external_link" });
      if (item.status === "verified")
        throw new DomainError("upload_item_invalid_state", { itemId, reason: "already_verified" });
      return {
        objectKey: item.objectKey,
        mimeType: item.mimeType,
        declaredSize: item.declaredSize ?? null,
        fileName: item.fileName,
      };
    });
  },
});

/** 誤提出した版の無効化（v1）。受付中の版のみ。理由必須。以後の版番号は欠番にならない。 */
export const voidRevision = mutation({
  args: { revisionId: v.id("revisions"), reason: v.string() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const r = await voidRevisionUseCase(createAppContext(ctx.db), principal, args);
      return { reviewState: r.reviewState };
    });
  },
});

/** cron: 期限切れの open なアップロードセッションを abandoned にする（D14 の清掃）。 */
export const expireSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ids = await expireUploadSessions(createAppContext(ctx.db), 100);
    return ids.length;
  },
});

/**
 * 清掃: abandoned セッションの未削除オブジェクト一覧（Hono の cron が http.ts 経由で取得）。
 * 放置されたフィードバックの添付も同じ一覧に載せる（itemId は "feedback:{添付 ID}"。Hono には不透明な ID）。
 */
export const listOrphanObjects = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const app = createAppContext(ctx.db);
    const max = Math.min(limit ?? 100, 500);
    const uploads = await listOrphanUploadObjects(app, max);
    if (uploads.length >= max) return uploads;
    return [...uploads, ...(await listOrphanFeedbackObjects(app, max - uploads.length))];
  },
});

/** 清掃: R2 から削除済みの項目を記録（冪等）。"feedback:" で始まるものはフィードバックの添付。 */
export const markObjectsPurged = internalMutation({
  args: { itemIds: v.array(v.string()) },
  handler: async (ctx, { itemIds }) => {
    const app = createAppContext(ctx.db);
    const ids = itemIds.slice(0, 500);
    const feedback = ids
      .filter((id) => id.startsWith(FEEDBACK_ORPHAN_PREFIX))
      .map((id) => id.slice(FEEDBACK_ORPHAN_PREFIX.length));
    const uploads = ids.filter((id) => !id.startsWith(FEEDBACK_ORPHAN_PREFIX));
    return (
      (await markUploadObjectsPurged(app, uploads)) +
      (await markFeedbackObjectsPurged(app, feedback))
    );
  },
});
