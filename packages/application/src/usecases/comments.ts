import {
  type Anchor,
  anchorFitsArtifact,
  assertCanPostComment,
  type CommentThread,
  type DecisionAction,
  decideThread as decideThreadDomain,
  DomainError,
  isAccepting,
  type Principal,
  type Severity,
  type ThreadKind,
  validateAnchor,
} from "@mf100/domain";
import type { AppContext, PersonProfile } from "../ports.ts";
import { checkMentions, idempotent, loadAuthorizedWork, searchPeopleByText } from "../shared.ts";
import { markRevisionViewed } from "./reviews.ts";
import { about, excerpt, notify, personName } from "./notifications.ts";
import {
  allMembersCanView,
  assertCanReactToComment,
  assertThreadNotDeleted,
  deleteReply as deleteReplyDomain,
  planThreadDeletion,
  editThreadBody,
  isCarryCandidate,
  mentionableUserIds,
  planCarryForward,
  replyEntries,
  revisionLabel,
  summarizeCommentReactions,
  toggleReplyReaction,
  toggleThreadReaction,
  type ReactionSummary,
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
  const mentions = await checkMentions(ctx, work, grants, input.mentions);

  const now = ctx.clock.now();
  const siblings = await ctx.revisions.listByWork(work.id);
  const latestAccepting = siblings.find(isAccepting) ?? null;
  assertCanPostComment(revision, now, latestAccepting?.id ?? null);

  if (input.anchor) {
    validateAnchor(input.anchor);
    const artifact = await ctx.artifacts.findById(input.anchor.artifactId);
    // 添付はこの版のもので、種類が合うこと（Web の要素は URL の添付、Figma のフレームは Figma の URL の添付）
    if (
      !artifact ||
      artifact.revisionId !== revision.id ||
      !anchorFitsArtifact(input.anchor, artifact)
    ) {
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
          preview: input.body,
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
 * 返信: 制作物を見られる人なら誰でも、受付の前後に依らず可（利用者決定 2026-10-18。D5 の暫定を改める）。校了後は不可。
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
    "comment.reply",
  );
  if (work.lifecycle === "finalized")
    throw new DomainError("work_already_finalized", { workId: work.id });
  assertThreadNotDeleted(thread);
  const now = ctx.clock.now();
  const mentions = await checkMentions(ctx, work, grants, input.mentions);
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

/**
 * コメント（スレッド）または返信へのリアクションを付ける・外す。付いた後の集計を返す（利用者決定 2026-10-18）。
 * 付けられる人は返信と同じ（制作物を見られる人。校了後は不可）。同じ人は 1 つの絵文字に 1 回だけで、押すたびに付け外しする。
 * 通知は出さない（FB のリアクションと同じ）。replyEventId を渡すとその返信へ、無ければコメントへ。
 */
export async function toggleCommentReaction(
  ctx: AppContext,
  principal: Principal,
  input: { threadId: string; replyEventId?: string; emoji: string },
): Promise<ReactionSummary[]> {
  const thread = await ctx.threads.findById(input.threadId);
  if (!thread) throw new DomainError("forbidden", { threadId: input.threadId });
  const revision = await ctx.revisions.findById(thread.revisionId);
  if (!revision) throw new DomainError("forbidden", { threadId: input.threadId });
  const { work } = await loadAuthorizedWork(ctx, principal, revision.workId, "comment.reply");
  assertCanReactToComment(work.lifecycle);
  if (input.replyEventId === undefined) {
    const next = toggleThreadReaction(thread, input.emoji, principal.userId);
    await ctx.threads.update(next);
    return summarizeCommentReactions(next.reactions, principal.userId);
  }
  assertThreadNotDeleted(thread);
  const events = await ctx.threads.listEvents(thread.id);
  const next = toggleReplyReaction(
    events,
    input.replyEventId,
    input.emoji,
    principal.userId,
    thread.id,
  );
  await ctx.threads.setEventReactions(input.replyEventId, next);
  return summarizeCommentReactions(next, principal.userId);
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
    preview: at.body,
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

  assertThreadNotDeleted(thread);
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
      preview: `「${label}」にしました`,
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
  assertThreadNotDeleted(thread);
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
      preview: thread.body,
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
  assertThreadNotDeleted(thread);
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

/**
 * コメントの削除（投稿者本人は校了前だけ。システム管理者は他人のものも校了後も。利用者指示 2026-10-19）。論理削除で、原文と履歴は CommentEvent に残る。
 * - 本人の削除: 他の人の返信が残るなら一覧に「削除されたコメント」として残し、無ければ一覧からも消す（domain/comment/deletion.ts）。
 * - システム管理者の削除: スレッドと全ての返信をまとめて論理削除する（利用者決定 2026-10-19）。各返信に reply_deleted、
 *   スレッドに "deleted"（cascade・返信の件数つき）を追記し、監査には 1 件だけ残す（誰が・いつ・元の投稿者・返信の件数・校了後か）。
 */
export async function deleteThread(
  ctx: AppContext,
  principal: Principal,
  input: { threadId: string },
): Promise<CommentThread> {
  const thread = await ctx.threads.findById(input.threadId);
  if (!thread) throw new DomainError("forbidden", { threadId: input.threadId });
  const revision = await ctx.revisions.findById(thread.revisionId);
  if (!revision) throw new DomainError("forbidden", { threadId: input.threadId });
  const { work } = await loadAuthorizedWork(ctx, principal, revision.workId, "work.view");
  const now = ctx.clock.now();
  const events = await ctx.threads.listEvents(thread.id);
  const plan = planThreadDeletion(thread, principal.userId, work.lifecycle, events, now, principal);
  const next = plan.thread;
  await ctx.threads.update(next);
  for (const replyEventId of plan.cascadeReplyIds)
    await ctx.threads.appendEvent({
      threadId: thread.id,
      eventType: "reply_deleted",
      actorId: principal.userId,
      payload: { replyEventId, cascade: true },
      createdAt: now,
    });
  const cascade = plan.authority === "admin";
  await ctx.threads.appendEvent({
    threadId: thread.id,
    eventType: "deleted",
    actorId: principal.userId,
    payload: {
      keepsReplies: next.deletedKeepsReplies === true,
      ...(cascade ? { cascade: true, repliesDeleted: plan.cascadeReplyIds.length } : {}),
    },
    createdAt: now,
  });
  if (cascade)
    await recordAdminDeletion(ctx, principal, {
      entityType: "commentThread",
      entityId: thread.id,
      authorId: thread.authorId,
      workId: work.id,
      revisionId: thread.revisionId,
      lifecycle: work.lifecycle,
      at: now,
      repliesDeleted: plan.cascadeReplyIds.length,
    });
  return next;
}

/**
 * 管理者による他人のコメント・返信の削除を監査に残す（本人の削除は CommentEvent が履歴）。
 * 校了後の削除かも記録する。スレッドの削除は返信ごとまとめて消すので、返信の件数も 1 件の記録に入れる。
 */
async function recordAdminDeletion(
  ctx: AppContext,
  principal: Principal,
  d: {
    entityType: "commentThread" | "commentReply";
    entityId: string;
    authorId: string;
    workId: string;
    revisionId: string;
    lifecycle: string;
    at: number;
    threadId?: string;
    repliesDeleted?: number;
  },
): Promise<void> {
  if (!principal.isSystemAdmin) return;
  // 自分の返信・コメントを（校了前に）自分で消すのは本人の削除。スレッドのまとめ削除は管理者の権限なので常に残す
  if (d.entityType === "commentReply" && d.authorId === principal.userId) return;
  await ctx.audit.record({
    entityType: d.entityType,
    entityId: d.entityId,
    operation: "delete",
    actorId: principal.userId,
    before: { authorId: d.authorId },
    after: {
      byAdmin: true,
      workId: d.workId,
      revisionId: d.revisionId,
      ...(d.threadId !== undefined ? { threadId: d.threadId } : {}),
      ...(d.repliesDeleted !== undefined ? { repliesDeleted: d.repliesDeleted } : {}),
      afterFinalized: d.lifecycle === "finalized",
    },
    at: d.at,
  });
}

/** 返信の削除（返信した本人は校了前だけ。システム管理者は他人のものも校了後も）。返信の本文は元のイベントに残り、削除は reply_deleted として追記する。 */
export async function deleteReply(
  ctx: AppContext,
  principal: Principal,
  input: { threadId: string; replyEventId: string },
): Promise<void> {
  const thread = await ctx.threads.findById(input.threadId);
  if (!thread) throw new DomainError("forbidden", { threadId: input.threadId });
  const revision = await ctx.revisions.findById(thread.revisionId);
  if (!revision) throw new DomainError("forbidden", { threadId: input.threadId });
  const { work } = await loadAuthorizedWork(ctx, principal, revision.workId, "work.view");
  const events = await ctx.threads.listEvents(thread.id);
  const next = deleteReplyDomain(
    thread,
    input.replyEventId,
    principal.userId,
    work.lifecycle,
    events,
    principal,
  );
  const now = ctx.clock.now();
  await ctx.threads.appendEvent({
    threadId: thread.id,
    eventType: "reply_deleted",
    actorId: principal.userId,
    payload: { replyEventId: input.replyEventId },
    createdAt: now,
  });
  const replyAuthor = replyEntries(events).find((r) => r.id === input.replyEventId)!.actorId;
  await recordAdminDeletion(ctx, principal, {
    entityType: "commentReply",
    entityId: input.replyEventId,
    threadId: thread.id,
    authorId: replyAuthor,
    workId: work.id,
    revisionId: thread.revisionId,
    lifecycle: work.lifecycle,
    at: now,
  });
  if (next !== thread) await ctx.threads.update(next);
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
  assertThreadNotDeleted(source);
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
    preview: source.body,
    workId: work.id,
    revisionId: target.id,
    threadId: created.id,
  });
  return created;
}

/**
 * メンションの候補を「@」に続けて打った文字で探す: その制作物を見られる人のうち、名前・メールが一致する人（名前順・limit 人まで）。
 * 候補を取れるのも見られる人だけ。
 * 通常の制作物は委員なら誰でも見られる（WorkViewPolicy）ので名簿（500 人まで）から探し、
 * 非公開は職責・ACL・関係者・担当の所属がある人（利用者決定 2026-10-17）の小さな一覧から探す。
 * 画面は名簿を丸ごと購読せず、打つたびにこの検索を引く（docs/UI_M3E.md §60）。
 */
export async function searchMentionCandidates(
  ctx: AppContext,
  principal: Principal,
  input: { workId: string; text: string; limit?: number },
): Promise<PersonProfile[]> {
  const { work, grants } = await loadAuthorizedWork(ctx, principal, input.workId, "work.view");
  const people = allMembersCanView(work)
    ? await ctx.people.listMembers(500)
    : await ctx.people.profiles(mentionableUserIds(work, grants, await ctx.teams.list()));
  return searchPeopleByText(people, input.text, input.limit);
}
