import {
  type Anchor,
  assertCanPostComment,
  type CommentThread,
  type DecisionAction,
  decideThread as decideThreadDomain,
  DomainError,
  isAccepting,
  isAllowed,
  type Principal,
  type Severity,
  type ThreadKind,
  validateAnchor,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { idempotent, loadAuthorizedWork } from "../shared.ts";
import { markRevisionViewed } from "./reviews.ts";

export interface PostCommentInput {
  revisionId: string;
  body: string;
  kind: ThreadKind;
  severity: Severity;
  anchor?: Anchor;
  requestId?: string;
}

/**
 * 新規指摘（F-06 / F-07 / A-04 / A-06）。
 * - 対象版が受付中・期限前・最新の受付対象版であることをサーバーで強制する。
 * - 校了済みの作品には投稿できない（§5.2-5）。
 * - 投稿しても校正者の確認状態・指摘の解決・校了には影響しない。
 */
export async function postComment(ctx: AppContext, principal: Principal, input: PostCommentInput): Promise<CommentThread> {
  const revision = await ctx.revisions.findById(input.revisionId);
  if (!revision) throw new DomainError("forbidden", { revisionId: input.revisionId });
  const { work } = await loadAuthorizedWork(ctx, principal, revision.workId, "comment.post");
  if (work.lifecycle === "finalized") throw new DomainError("work_already_finalized", { workId: work.id });
  if (input.body.trim() === "") throw new DomainError("forbidden", { reason: "body_required" });

  const now = ctx.clock.now();
  const siblings = await ctx.revisions.listByWork(work.id);
  const latestAccepting = siblings.find(isAccepting) ?? null;
  assertCanPostComment(revision, now, latestAccepting?.id ?? null);

  if (input.anchor) {
    validateAnchor(input.anchor);
    const artifact = await ctx.artifacts.findById(input.anchor.artifactId);
    if (!artifact || artifact.revisionId !== revision.id) {
      throw new DomainError("anchor_artifact_mismatch", { artifactId: input.anchor.artifactId, revisionId: revision.id });
    }
  }

  return idempotent(ctx, `postComment:${revision.id}:${principal.userId}`, input.requestId, async () => {
    const data: Omit<CommentThread, "id"> = {
      revisionId: revision.id,
      authorId: principal.userId,
      body: input.body,
      kind: input.kind,
      severity: input.severity,
      resolution: "open",
      createdAt: now,
    };
    if (input.anchor) {
      data.anchor = input.anchor;
      data.artifactId = input.anchor.artifactId;
    }
    const thread = await ctx.threads.insert(data);
    await ctx.threads.appendEvent({ threadId: thread.id, eventType: "created", actorId: principal.userId, createdAt: now });
    await markRevisionViewed(ctx, principal, revision.id);
    return thread;
  });
}

/**
 * 返信（D5 暫定）: 受付中は誰でも（投稿権限者）可。受付終了後は制作者（採否判断者）の処置記録のみ可。
 * 本文は CommentEvent として追記し、原文スレッドは書き換えない。
 */
export async function replyToThread(ctx: AppContext, principal: Principal, input: { threadId: string; body: string }): Promise<void> {
  const thread = await ctx.threads.findById(input.threadId);
  if (!thread) throw new DomainError("forbidden", { threadId: input.threadId });
  const revision = await ctx.revisions.findById(thread.revisionId);
  if (!revision) throw new DomainError("forbidden", { threadId: input.threadId });
  const { work, grants } = await loadAuthorizedWork(ctx, principal, revision.workId, "comment.post");
  if (work.lifecycle === "finalized") throw new DomainError("work_already_finalized", { workId: work.id });
  const now = ctx.clock.now();
  const open = isAccepting(revision) && now < revision.deadlineAt;
  if (!open && !isAllowed("comment.decide", { work, grants, principal })) {
    throw new DomainError("comment_reply_not_allowed", { threadId: thread.id });
  }
  await ctx.threads.appendEvent({ threadId: thread.id, eventType: "replied", actorId: principal.userId, payload: { body: input.body }, createdAt: now });
}

export interface DecideThreadInput {
  threadId: string;
  action: DecisionAction;
  reason?: string;
}

/**
 * 指摘の採否判断（C4 / F-07 / A-07）。制作者または明示委任（edit）のみ。
 * 旧版の受付終了後でも処置記録は可能（D5 暫定）。校了済み作品では不可（A-09）。
 */
export async function decideThread(ctx: AppContext, principal: Principal, input: DecideThreadInput): Promise<CommentThread> {
  const thread = await ctx.threads.findById(input.threadId);
  if (!thread) throw new DomainError("forbidden", { threadId: input.threadId });
  const revision = await ctx.revisions.findById(thread.revisionId);
  if (!revision) throw new DomainError("forbidden", { threadId: input.threadId });
  const { work } = await loadAuthorizedWork(ctx, principal, revision.workId, "comment.decide");
  if (work.lifecycle === "finalized") throw new DomainError("work_already_finalized", { workId: work.id });

  const next = decideThreadDomain(thread, input.action, input.reason);
  const now = ctx.clock.now();
  await ctx.threads.update(next);
  const event = {
    threadId: thread.id,
    eventType: "decided" as const,
    actorId: principal.userId,
    payload: { from: thread.resolution, to: input.action },
    createdAt: now,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  };
  await ctx.threads.appendEvent(event);
  return next;
}
