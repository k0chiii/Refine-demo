import {
  commentFileFromFeedbackFile,
  deriveThreadActivity,
  FEEDBACK_MIGRATION_ACTOR,
  FEEDBACK_MIGRATION_REASON,
  isLiveFeedbackThread,
  planFeedbackThreadMigration,
  resolveMigratedThread,
  withThreadActivity,
  type CommentFile,
  type FeedbackFile,
  type FeedbackMigrationPlan,
  type FeedbackThread,
  type Principal,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";

/*
 * FB（フィードバック）のコメントへの移行（利用者決定 2026-10-20「既存の FB はコメントへ移す」「過去の FB データは消して良い」）。
 * 何をどう移すかの規則は domain の feedback/migration.ts。ここは、それを読み込んだ状態に当てはめて書き込む手順。
 * 一度に移す数の上限・分割実行（カーソル）は呼び出し側（Convex の内部関数）が受け持ち、ここは 1 スレッド単位。
 * 何度流しても増えない（移行元のスレッド ID で二重に移さない）。
 */

/** 1 スレッドを移す（または移すつもりで数える）結果 */
export type FeedbackThreadMigrationResult =
  | { status: "skipped"; reason: "not_live" | "no_posts" | "no_revision" }
  | { status: "already_migrated"; commentThreadId: string }
  | {
      status: "migrated" | "will_migrate";
      workId: string;
      resolution: "open" | "resolved";
      /** 返信になる投稿の数（最初の投稿はコメント本体なので数えない） */
      replies: number;
      /** 移す添付の数 */
      files: number;
      /** 移さない添付の数（検証に失敗した・放置された・消えたもの） */
      filesSkipped: number;
      /** 引き継ぐ既読の印の数 */
      reads: number;
      /** 移し先のコメントのスレッド（書き込んだときだけ） */
      commentThreadId?: string;
    };

type Prepared =
  | { kind: "result"; result: FeedbackThreadMigrationResult }
  | {
      kind: "plan";
      plan: FeedbackMigrationPlan;
      files: Map<string, FeedbackFile>;
      missingFiles: number;
      reads: Array<{ userId: string; readAt: number }>;
    };

/** 移す前の読み込みと計画。書き込みはしない（数えるだけの実行も、移す実行も同じ道を通る） */
async function prepare(ctx: AppContext, thread: FeedbackThread): Promise<Prepared> {
  if (!isLiveFeedbackThread(thread))
    return { kind: "result", result: { status: "skipped", reason: "not_live" } };
  const done = await ctx.threads.findByMigratedFrom(thread.id);
  if (done)
    return { kind: "result", result: { status: "already_migrated", commentThreadId: done.id } };
  const work = await ctx.works.findById(thread.workId);
  if (!work) return { kind: "result", result: { status: "skipped", reason: "no_revision" } };
  const decision = planFeedbackThreadMigration({
    thread,
    posts: await ctx.feedback.listPosts(thread.id),
    revisions: await ctx.revisions.listByWork(thread.workId),
    workLifecycle: work.lifecycle,
  });
  if (decision.kind === "skip")
    return { kind: "result", result: { status: "skipped", reason: decision.reason } };
  const { plan } = decision;
  const files = new Map<string, FeedbackFile>();
  let missingFiles = 0;
  for (const id of [...plan.sourceFileIds, ...plan.replies.flatMap((r) => r.sourceFileIds)]) {
    const file = await ctx.feedback.findFile(id);
    if (file) files.set(id, file);
    else missingFiles++;
  }
  return {
    kind: "plan",
    plan,
    files,
    missingFiles,
    reads: await ctx.feedback.listReads(thread.id),
  };
}

function summarize(p: Extract<Prepared, { kind: "plan" }>, status: "migrated" | "will_migrate") {
  let files = 0;
  let skipped = p.missingFiles;
  for (const f of p.files.values())
    if (commentFileFromFeedbackFile(f, { threadId: "", revisionId: "" })) files++;
    else skipped++;
  return {
    status,
    workId: p.plan.workId,
    resolution: p.plan.resolution,
    replies: p.plan.replies.length,
    files,
    filesSkipped: skipped,
    reads: p.reads.length,
  } as const;
}

/** 書き込まずに、移したときの結果を返す（dry-run） */
export async function previewFeedbackThreadMigration(
  ctx: AppContext,
  thread: FeedbackThread,
): Promise<FeedbackThreadMigrationResult> {
  const p = await prepare(ctx, thread);
  return p.kind === "result" ? p.result : summarize(p, "will_migrate");
}

/**
 * FB のスレッド 1 つをコメントへ移す。
 * 最初の投稿 → コメント本体、残りの投稿 → 返信、添付 → 同じ R2 の実体を指すコメントの添付（コピーしない）、
 * 既読の印 → コメントの既読。未解決で移さないスレッドには、採否の履歴（FB から移行）を残す。
 * 同じ FB のスレッドを 2 度移さない（移行済みなら何もしない）。
 */
export async function migrateFeedbackThread(
  ctx: AppContext,
  thread: FeedbackThread,
): Promise<FeedbackThreadMigrationResult> {
  const p = await prepare(ctx, thread);
  if (p.kind === "result") return p.result;
  const { plan } = p;

  let comment = await ctx.threads.insert(plan.thread);
  const at = { threadId: comment.id, revisionId: plan.revisionId };
  await ctx.threads.appendEvent({
    threadId: comment.id,
    eventType: "created",
    actorId: comment.authorId,
    createdAt: comment.createdAt,
  });

  /** 添付を、まだ返信に結び付けない状態で作る（返信のイベントに ID を持たせるため先に作る） */
  const copyFiles = async (sourceIds: readonly string[]): Promise<CommentFile[]> => {
    const out: CommentFile[] = [];
    for (const id of sourceIds) {
      const source = p.files.get(id);
      const data = source ? commentFileFromFeedbackFile(source, at) : null;
      if (data) out.push(await ctx.commentFiles.insertFile(data));
    }
    return out;
  };

  const firstFiles = await copyFiles(plan.sourceFileIds);
  if (firstFiles.length) comment = { ...comment, fileIds: firstFiles.map((f) => f.id) };

  for (const reply of plan.replies) {
    const files = await copyFiles(reply.sourceFileIds);
    const eventId = await ctx.threads.appendEvent({
      threadId: comment.id,
      eventType: "replied",
      actorId: reply.authorId,
      payload: {
        body: reply.body,
        ...(reply.mentions.length ? { mentions: reply.mentions } : {}),
        ...(files.length ? { fileIds: files.map((f) => f.id) } : {}),
      },
      ...(reply.reactions.length ? { reactions: reply.reactions } : {}),
      createdAt: reply.createdAt,
    });
    for (const f of files) await ctx.commentFiles.updateFile({ ...f, eventId });
  }

  // 返信の件数・参加者・最後の動きは、書いた返信から導く（コメントを投稿・返信したときと同じ導き方）
  comment = withThreadActivity(
    comment,
    deriveThreadActivity(comment, await ctx.threads.listEvents(comment.id)),
  );
  if (plan.resolution === "resolved") {
    comment = resolveMigratedThread(comment);
    await ctx.threads.appendEvent({
      threadId: comment.id,
      eventType: "decided",
      actorId: FEEDBACK_MIGRATION_ACTOR,
      reason: FEEDBACK_MIGRATION_REASON,
      payload: { from: "open", to: "resolved" },
      createdAt: ctx.clock.now(),
    });
  }
  await ctx.threads.update(comment);
  for (const r of p.reads) await ctx.threads.markRead(r.userId, comment.id, r.readAt);

  return { ...summarize(p, "migrated"), commentThreadId: comment.id };
}

/**
 * 旧 FB のスレッドの URL（/feedback/{スレッド}）から、移し先のコメントを引く（開く画面は /revisions/{版}?thread={コメント}）。
 * 移していない・コメントが削除された・見られない制作物なら null（存在を漏らさない）
 */
export async function resolveMigratedFeedbackThread(
  ctx: AppContext,
  principal: Principal,
  feedbackThreadId: string,
): Promise<{ revisionId: string; threadId: string } | null> {
  const thread = await ctx.threads.findByMigratedFrom(feedbackThreadId);
  if (!thread || thread.deletedAt !== undefined) return null;
  const revision = await ctx.revisions.findById(thread.revisionId);
  if (!revision) return null;
  try {
    await loadAuthorizedWork(ctx, principal, revision.workId, "work.view");
  } catch {
    return null;
  }
  return { revisionId: revision.id, threadId: thread.id };
}

/**
 * 削除してよい状態か（FB のスレッド 1 つぶん）。コメントへ移し終えたか、もともと削除済み・生きた投稿の無いものだけ true。
 * 版が無い制作物のスレッドなど、生きているのに移せなかったものが 1 つでもあれば削除を止める（コメント・FB を消さない。利用者指示 2026-10-20）。
 */
export async function isFeedbackThreadSettled(
  ctx: AppContext,
  thread: FeedbackThread,
): Promise<boolean> {
  const p = await prepare(ctx, thread);
  if (p.kind === "plan") return false;
  const r = p.result;
  return r.status === "already_migrated" || (r.status === "skipped" && r.reason !== "no_revision");
}

// ---------------------------------------------------------------- 集計（dry-run と本番の実行で同じ数え方）

/** 走査した FB のスレッドの内訳。dry-run（will_migrate）と実行（migrated）で同じ形 */
export interface FeedbackMigrationTotals {
  /** 走査した FB のスレッド（削除済み・投稿の無いものを含む） */
  scanned: number;
  /** 移す（移した）スレッド */
  threads: number;
  /** 既にコメントへ移してあったスレッド */
  alreadyMigrated: number;
  /** 制作物に版が無く、移さないスレッド */
  skippedNoRevision: number;
  /** 削除済み・生きた投稿の無い、対象外のスレッド */
  skippedNotLive: number;
  /** 返信になる投稿 */
  replies: number;
  /** 移す添付と、移さない添付 */
  files: number;
  filesSkipped: number;
  /** 引き継ぐ既読の印 */
  reads: number;
  /** 未解決で移す・解決済みで移すスレッド */
  open: number;
  resolved: number;
  /** 制作物ごとの、移す（移した）スレッド数 */
  perWork: Record<string, number>;
}

export function emptyFeedbackMigrationTotals(): FeedbackMigrationTotals {
  return {
    scanned: 0,
    threads: 0,
    alreadyMigrated: 0,
    skippedNoRevision: 0,
    skippedNotLive: 0,
    replies: 0,
    files: 0,
    filesSkipped: 0,
    reads: 0,
    open: 0,
    resolved: 0,
    perWork: {},
  };
}

/** 1 スレッドの結果を足す */
export function addFeedbackMigrationResult(
  t: FeedbackMigrationTotals,
  r: FeedbackThreadMigrationResult,
): void {
  t.scanned++;
  if (r.status === "already_migrated") t.alreadyMigrated++;
  else if (r.status === "skipped") {
    if (r.reason === "no_revision") t.skippedNoRevision++;
    else t.skippedNotLive++;
  } else {
    t.threads++;
    t.replies += r.replies;
    t.files += r.files;
    t.filesSkipped += r.filesSkipped;
    t.reads += r.reads;
    if (r.resolution === "open") t.open++;
    else t.resolved++;
    t.perWork[r.workId] = (t.perWork[r.workId] ?? 0) + 1;
  }
}

/** 分割実行の途中経過を足し合わせる */
export function mergeFeedbackMigrationTotals(
  a: FeedbackMigrationTotals,
  b: FeedbackMigrationTotals,
): FeedbackMigrationTotals {
  const perWork = { ...a.perWork };
  for (const [id, n] of Object.entries(b.perWork)) perWork[id] = (perWork[id] ?? 0) + n;
  return {
    scanned: a.scanned + b.scanned,
    threads: a.threads + b.threads,
    alreadyMigrated: a.alreadyMigrated + b.alreadyMigrated,
    skippedNoRevision: a.skippedNoRevision + b.skippedNoRevision,
    skippedNotLive: a.skippedNotLive + b.skippedNotLive,
    replies: a.replies + b.replies,
    files: a.files + b.files,
    filesSkipped: a.filesSkipped + b.filesSkipped,
    reads: a.reads + b.reads,
    open: a.open + b.open,
    resolved: a.resolved + b.resolved,
    perWork,
  };
}

/** 移すスレッドが多い制作物（多い順、同数は ID 順） */
export function topFeedbackMigrationWorks(
  t: Pick<FeedbackMigrationTotals, "perWork">,
  limit = 20,
): Array<{ workId: string; threads: number }> {
  return Object.entries(t.perWork)
    .map(([workId, threads]) => ({ workId, threads }))
    .sort((a, b) => b.threads - a.threads || a.workId.localeCompare(b.workId))
    .slice(0, limit);
}
