import {
  type Anchor,
  assertCanPostComment,
  type CommentThread,
  type DecisionAction,
  decideThread as decideThreadDomain,
  DomainError,
  isAccepting,
  isAllowed,
  isBeforeDeadline,
  type Principal,
  type Severity,
  type ThreadKind,
  validateAnchor,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { idempotent, loadAuthorizedWork } from "../shared.ts";
import { markRevisionViewed } from "./reviews.ts";
import { about, excerpt, notify, personName } from "./notifications.ts";
import {
  editThreadBody,
  isCarryCandidate,
  mentionableUserIds,
  planCarryForward,
  revisionLabel,
  validateMentions,
} from "@mf100/domain";

/** 通知文面用の採否ラベル（表示名は UI 側と同じ日本語。状態名自体は設計提案）。 */
const resolutionLabels: Record<string, string> = {
  acknowledged: "確認済み",
  accepted: "採用",
  rejected: "不採用",
  deferred: "次版へ持ち越し",
  resolved: "反映済み",
};

export interface PostCommentInput {
  revisionId: string;
  body: string;
  kind: ThreadKind;
  severity: Severity;
  anchor?: Anchor;
  requestId?: string;
  /** 本文でメンションした人（制作物を見られる人だけ。上限 10） */
  mentions?: string[];
}

/**
 * 新しいコメント（要件の「指摘」。F-06 / F-07 / A-04 / A-06）。
 * - 対象版が受付中・期限前・最新の受付対象版であることをサーバーで強制する。
 * - 校了済みの作品には投稿できない（§5.2-5）。
 * - 投稿しても校正者の確認状態・指摘の解決・校了には影響しない。
 */
export async function postComment(
  ctx: AppContext,
  principal: Principal,
  input: PostCommentInput,
): Promise<CommentThread> {
  const revision = await ctx.revisions.findById(input.revisionId);
  if (!revision) throw new DomainError("forbidden", { revisionId: input.revisionId });
  const { work, grants } = await loadAuthorizedWork(
    ctx,
    principal,
    revision.workId,
    "comment.post",
  );
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  if (input.body.trim() === "") throw new DomainError("forbidden", { reason: "body_required" });
  const mentions = validateMentions(input.mentions, work, grants);

  const now = ctx.clock.now();
  const siblings = await ctx.revisions.listByWork(work.id);
  const latestAccepting = siblings.find(isAccepting) ?? null;
  assertCanPostComment(revision, now, latestAccepting?.id ?? null);

  if (input.anchor) {
    validateAnchor(input.anchor);
    const artifact = await ctx.artifacts.findById(input.anchor.artifactId);
    if (!artifact || artifact.revisionId !== revision.id) {
      throw new DomainError("anchor_artifact_mismatch", {
        artifactId: input.anchor.artifactId,
        revisionId: revision.id,
      });
    }
  }

  return idempotent(
    ctx,
    `postComment:${revision.id}:${principal.userId}`,
    input.requestId,
    async () => {
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
      if (mentions.length) data.mentions = mentions;
      const thread = await ctx.threads.insert(data);
      await ctx.threads.appendEvent({
        threadId: thread.id,
        eventType: "created",
        actorId: principal.userId,
        createdAt: now,
      });
      await markRevisionViewed(ctx, principal, revision.id);
      // メンションされた人には「メンション」だけを送る（制作者がメンションされたら新しいコメントの通知と重ねない）
      const who = await personName(ctx, principal.userId);
      await notify(
        ctx,
        work.creatorIds.filter((id) => !mentions.includes(id)),
        principal.userId,
        {
          kind: "comment_posted",
          title: "新しいコメント",
          body: `${about(work.title, revisionLabel(revision), who)}: ${excerpt(input.body)}`,
          workId: work.id,
          revisionId: revision.id,
          threadId: thread.id,
        },
      );
      await notifyMentions(ctx, principal.userId, mentions, work.title, revisionLabel(revision), {
        body: input.body,
        workId: work.id,
        revisionId: revision.id,
        threadId: thread.id,
      });
      return thread;
    },
  );
}

/**
 * 返信（D5 暫定）: 受付中は誰でも（投稿権限者）可。受付終了後は制作者（採否判断者）の処置記録のみ可。
 * 本文は CommentEvent として追記し、原文スレッドは書き換えない。
 */
export async function replyToThread(
  ctx: AppContext,
  principal: Principal,
  input: { threadId: string; body: string; mentions?: string[] },
): Promise<void> {
  if (input.body.trim() === "") throw new DomainError("forbidden", { reason: "body_required" });
  const thread = await ctx.threads.findById(input.threadId);
  if (!thread) throw new DomainError("forbidden", { threadId: input.threadId });
  const revision = await ctx.revisions.findById(thread.revisionId);
  if (!revision) throw new DomainError("forbidden", { threadId: input.threadId });
  const { work, grants } = await loadAuthorizedWork(
    ctx,
    principal,
    revision.workId,
    "comment.post",
  );
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  const now = ctx.clock.now();
  const open = isAccepting(revision) && isBeforeDeadline(now, revision.deadlineAt);
  if (!open && !isAllowed("comment.decide", { work, grants, principal })) {
    throw new DomainError("comment_reply_not_allowed", { threadId: thread.id });
  }
  const mentions = validateMentions(input.mentions, work, grants);
  await ctx.threads.appendEvent({
    threadId: thread.id,
    eventType: "replied",
    actorId: principal.userId,
    payload: mentions.length ? { body: input.body, mentions } : { body: input.body },
    createdAt: now,
  });
  await notifyMentions(ctx, principal.userId, mentions, work.title, revisionLabel(revision), {
    body: input.body,
    workId: work.id,
    revisionId: revision.id,
    threadId: thread.id,
  });
}

/** メンションされた人に知らせる（本人は除く。見られる人かは validateMentions で確認済み） */
async function notifyMentions(
  ctx: AppContext,
  actorId: string,
  mentions: readonly string[],
  workTitle: string,
  label: string,
  at: { body: string; workId: string; revisionId: string; threadId: string },
) {
  if (!mentions.length) return;
  const who = await personName(ctx, actorId);
  await notify(ctx, mentions, actorId, {
    kind: "mentioned",
    title: "メンションされました",
    body: `${about(workTitle, label, who)}: ${excerpt(at.body)}`,
    workId: at.workId,
    revisionId: at.revisionId,
    threadId: at.threadId,
  });
}

export interface DecideThreadInput {
  threadId: string;
  action: DecisionAction;
  reason?: string;
}

/**
 * コメントの採否判断（C4 / F-07 / A-07）。制作者または明示委任（edit）のみ。
 * 旧版の受付終了後でも処置記録は可能（D5 暫定）。校了済み作品では不可（A-09）。
 */
export async function decideThread(
  ctx: AppContext,
  principal: Principal,
  input: DecideThreadInput,
): Promise<CommentThread> {
  const thread = await ctx.threads.findById(input.threadId);
  if (!thread) throw new DomainError("forbidden", { threadId: input.threadId });
  const revision = await ctx.revisions.findById(thread.revisionId);
  if (!revision) throw new DomainError("forbidden", { threadId: input.threadId });
  const { work } = await loadAuthorizedWork(ctx, principal, revision.workId, "comment.decide");
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });

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
  const who = await personName(ctx, principal.userId);
  const label = resolutionLabels[input.action] ?? input.action;
  await notify(
    ctx,
    [thread.authorId, ...(thread.assigneeId ? [thread.assigneeId] : [])],
    principal.userId,
    {
      kind: "comment_decided",
      title: "コメントの採否が決まりました",
      body: `${about(work.title, revisionLabel(revision), who)}が「${label}」にしました${
        input.reason?.trim() ? `（理由: ${excerpt(input.reason, 60)}）` : ""
      }: ${excerpt(thread.body, 60)}`,
      workId: work.id,
      revisionId: revision.id,
      threadId: thread.id,
    },
  );
  return next;
}

/** コメントの担当者を割り当てる（F-07）。採否判断者（制作者・edit 委任者）のみ。 */
export async function assignThread(
  ctx: AppContext,
  principal: Principal,
  input: { threadId: string; assigneeId: string | null },
): Promise<CommentThread> {
  const thread = await ctx.threads.findById(input.threadId);
  if (!thread) throw new DomainError("forbidden", { threadId: input.threadId });
  const revision = await ctx.revisions.findById(thread.revisionId);
  if (!revision) throw new DomainError("forbidden", { threadId: input.threadId });
  const { work } = await loadAuthorizedWork(ctx, principal, revision.workId, "comment.decide");
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  const next: CommentThread = { ...thread };
  if (input.assigneeId) next.assigneeId = input.assigneeId;
  else delete next.assigneeId;
  await ctx.threads.update(next);
  const now = ctx.clock.now();
  await ctx.threads.appendEvent({
    threadId: thread.id,
    eventType: "assigned",
    actorId: principal.userId,
    payload: { assigneeId: input.assigneeId },
    createdAt: now,
  });
  if (input.assigneeId) {
    const who = await personName(ctx, principal.userId);
    await notify(ctx, [input.assigneeId], principal.userId, {
      kind: "comment_assigned",
      title: "コメントの対応担当になりました",
      body: `${about(work.title, revisionLabel(revision), who ? `${who}から` : null)}: ${excerpt(thread.body)}`,
      workId: work.id,
      revisionId: revision.id,
      threadId: thread.id,
    });
  }
  return next;
}

/** コメント本文の訂正（§5.2-9）。投稿者本人・未判断の間のみ。訂正前の本文をイベントに残す。 */
export async function editThread(
  ctx: AppContext,
  principal: Principal,
  input: { threadId: string; body: string },
): Promise<CommentThread> {
  const thread = await ctx.threads.findById(input.threadId);
  if (!thread) throw new DomainError("forbidden", { threadId: input.threadId });
  const revision = await ctx.revisions.findById(thread.revisionId);
  if (!revision) throw new DomainError("forbidden", { threadId: input.threadId });
  const { work } = await loadAuthorizedWork(ctx, principal, revision.workId, "comment.post");
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  const next = editThreadBody(thread, principal.userId, input.body);
  await ctx.threads.update(next);
  await ctx.threads.appendEvent({
    threadId: thread.id,
    eventType: "edited",
    actorId: principal.userId,
    payload: { previousBody: thread.body },
    createdAt: ctx.clock.now(),
  });
  return next;
}

/** 次版へ持ち越す候補（前版の未解決コメント）。対象版より前に提出され、受付中でない版のもの。 */
export async function listCarryCandidates(
  ctx: AppContext,
  principal: Principal,
  targetRevisionId: string,
): Promise<CommentThread[]> {
  const target = await ctx.revisions.findById(targetRevisionId);
  if (!target) throw new DomainError("forbidden", { revisionId: targetRevisionId });
  await loadAuthorizedWork(ctx, principal, target.workId, "work.view");
  const out: CommentThread[] = [];
  for (const r of await ctx.revisions.listByWork(target.workId)) {
    if (r.id === target.id || r.reviewState === "open" || r.submittedAt > target.submittedAt)
      continue;
    for (const t of await ctx.threads.listByRevision(r.id)) if (isCarryCandidate(t)) out.push(t);
  }
  return out;
}

/** 前版のコメントを次版へ持ち越す（F-07）。採否判断者のみ。元のコメントは deferred にし、新スレッドを作る。 */
export async function carryForwardThread(
  ctx: AppContext,
  principal: Principal,
  input: { threadId: string; targetRevisionId: string },
): Promise<CommentThread> {
  const source = await ctx.threads.findById(input.threadId);
  if (!source) throw new DomainError("forbidden", { threadId: input.threadId });
  const sourceRevision = await ctx.revisions.findById(source.revisionId);
  const target = await ctx.revisions.findById(input.targetRevisionId);
  if (!sourceRevision || !target || sourceRevision.workId !== target.workId)
    throw new DomainError("forbidden", { threadId: input.threadId });
  const { work } = await loadAuthorizedWork(ctx, principal, target.workId, "comment.decide");
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  if (!isAccepting(target))
    throw new DomainError("comment_carry_target_not_accepting", { targetRevisionId: target.id });
  const now = ctx.clock.now();
  const plan = planCarryForward(source, target.id, now);
  const created = await ctx.threads.insert(plan.target);
  await ctx.threads.update({ ...plan.sourceAfter, carriedToThreadId: created.id });
  await ctx.threads.appendEvent({
    threadId: source.id,
    eventType: "carried_forward",
    actorId: principal.userId,
    payload: { targetThreadId: created.id, targetRevisionId: target.id },
    createdAt: now,
  });
  await ctx.threads.appendEvent({
    threadId: created.id,
    eventType: "created",
    actorId: principal.userId,
    payload: { carriedFromThreadId: source.id },
    createdAt: now,
  });
  const who = await personName(ctx, principal.userId);
  await notify(ctx, [source.authorId], principal.userId, {
    kind: "comment_posted",
    title: "コメントが次の版へ持ち越されました",
    body: `${about(work.title, revisionLabel(target), who)}: ${excerpt(source.body)}`,
    workId: work.id,
    revisionId: target.id,
    threadId: created.id,
  });
  return created;
}

/** メンションの候補: その制作物を見られる人（見られる人だけが候補を取れる） */
export async function listMentionCandidates(
  ctx: AppContext,
  principal: Principal,
  workId: string,
): Promise<string[]> {
  const { work, grants } = await loadAuthorizedWork(ctx, principal, workId, "work.view");
  return mentionableUserIds(work, grants);
}
