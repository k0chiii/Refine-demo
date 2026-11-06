import {
  closeByDeadline,
  DomainError,
  formatDeadlineUntil,
  isDeadlineReached,
  isEndOfJstDayDeadline,
  isUnresponded,
  markResponded,
  markViewed,
  type Principal,
  type ReviewAssignment,
  type Revision,
  revisionLabel,
  startOfJstDay,
  toJstDate,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { about, notify } from "./notifications.ts";

/** 期限接近リマインドの 1 回分の範囲 */
export interface DeadlineReminderBatch {
  /** 締切まで windowMs 以内の版を対象にする（既定 24 時間） */
  windowMs?: number;
  /** 1 回で読む版の数 */
  limit?: number;
  /** 前回の continueCursor。最初は null */
  cursor?: string | null;
  /** 続きを読むときは最初の回の時刻をそのまま渡す（範囲を変えないため） */
  asOf?: number;
}

export interface DeadlineReminderBatchResult {
  sent: number;
  /** 続きがあれば次の回に渡すカーソル。無ければ null */
  continueCursor: string | null;
  asOf: number;
}

/** 校正締切の「当日」（JST の表示日）か */
function isRevisionDeadlineDay(now: number, deadlineAt: number): boolean {
  const deadlineDay = isEndOfJstDayDeadline(deadlineAt)
    ? toJstDate(deadlineAt - 1)
    : toJstDate(deadlineAt);
  return toJstDate(now) === deadlineDay;
}

/**
 * その版の未確認（pending/viewed）の割当に 1 回だけ通知する（冪等キーで版×校正者につき 1 回）。
 * 対象は「期限内の受付中の版」から引く。未確認の割当を先頭から読む方式だと、受付終了・期限切れの古い割当が
 * 先頭に溜まって現行の割当に届かなくなる（レビュー指摘）。版が多いときは continueCursor で続きを読む。
 * 判定は締切の時刻どうしの比較なので、日付だけの締切（その日の終わり＝翌日 0:00 JST）なら当日の 0:00 JST から届く。
 */
export async function remindUpcomingDeadlinesBatch(
  ctx: AppContext,
  opts: DeadlineReminderBatch = {},
): Promise<DeadlineReminderBatchResult> {
  const now = opts.asOf ?? ctx.clock.now();
  const windowMs = opts.windowMs ?? 24 * 3_600_000;
  const { page, continueCursor } = await ctx.revisions.listOpenDueWithin(
    { after: startOfJstDay(now), upTo: now + windowMs },
    { cursor: opts.cursor ?? null, limit: opts.limit ?? 100 },
  );
  let sent = 0;
  for (const revision of page) {
    // 索引の範囲で絞っているが、判定はドメインの規則でも確かめる
    if (revision.reviewState !== "open" || isDeadlineReached(now, revision.deadlineAt)) continue;
    if (revision.deadlineAt - now > windowMs) continue;
    // 利用者合意（2026-10-30）: 締切当日だけ、まだ校正を完了していない人へ
    if (!isRevisionDeadlineDay(now, revision.deadlineAt)) continue;
    const unresponded = (await ctx.assignments.listByRevision(revision.id)).filter(isUnresponded);
    if (unresponded.length === 0) continue;
    const work = await ctx.works.findById(revision.workId);
    if (!work) continue;
    for (const a of unresponded) {
      const key = `${revision.id}:${a.reviewerId}`;
      if (await ctx.idempotency.get("deadlineReminder", key)) continue;
      await notify(ctx, [a.reviewerId], null, {
        kind: "deadline_approaching",
        title: "校正の締切が近づいています",
        body: `${about(work.title, revisionLabel(revision))}・締切は ${formatDeadlineUntil(
          revision.deadlineAt,
          now,
        )}。それまでに校正画面で確かめ、「校正を完了」を押してください。締切を過ぎるとコメントできません。`,
        workId: work.id,
        revisionId: revision.id,
      });
      await ctx.idempotency.put("deadlineReminder", key, { sentAt: now });
      sent++;
    }
  }
  return { sent, continueCursor, asOf: now };
}

/**
 * 期限接近リマインドを最後のページまで続けて行う（インメモリ・テスト用。Convex では 1 回分ずつスケジューラで続ける）。
 * 送った件数を返す。
 */
export async function remindUpcomingDeadlines(
  ctx: AppContext,
  windowMs = 24 * 3_600_000,
  limit = 100,
): Promise<number> {
  let sent = 0;
  let cursor: string | null = null;
  const asOf = ctx.clock.now();
  do {
    const r = await remindUpcomingDeadlinesBatch(ctx, { windowMs, limit, cursor, asOf });
    sent += r.sent;
    cursor = r.continueCursor;
  } while (cursor !== null);
  return sent;
}

/** 校正者が版を開いたとき。pending → viewed のみ。responded には自動遷移しない。 */
export async function markRevisionViewed(
  ctx: AppContext,
  principal: Principal,
  revisionId: string,
): Promise<void> {
  const a = await ctx.assignments.find(revisionId, principal.userId);
  if (!a) return;
  const next = markViewed(a, ctx.clock.now());
  if (next !== a) await ctx.assignments.upsert(next);
}

/** 校正者が「自分の校正を完了」と明示したとき（A-06: コメント投稿では遷移しない）。 */
export async function completeMyReview(
  ctx: AppContext,
  principal: Principal,
  revisionId: string,
): Promise<ReviewAssignment> {
  const a = await ctx.assignments.find(revisionId, principal.userId);
  if (!a) throw new DomainError("forbidden", { revisionId });
  const next = markResponded(a, ctx.clock.now());
  await ctx.assignments.upsert(next);
  return next;
}

/**
 * 期限到来による受付終了ジョブ（F-08 / A-05）。
 * 受付だけを閉じる。未読・コメント・校了状態は変更しない。
 * このジョブが遅延しても assertCanPostComment が時刻比較で新しいコメントを拒否する。
 */
export async function closeExpiredReviews(ctx: AppContext, limit = 100): Promise<Revision[]> {
  const now = ctx.clock.now();
  const closed: Revision[] = [];
  for (const r of await ctx.revisions.listOpenExpired(now, limit)) {
    const next = closeByDeadline(r, now);
    if (next === r) continue;
    await ctx.revisions.update(next);
    await ctx.audit.record({
      entityType: "revision",
      entityId: r.id,
      operation: "review_closed:deadline",
      actorId: "system",
      at: now,
    });
    closed.push(next);
  }
  return closed;
}
