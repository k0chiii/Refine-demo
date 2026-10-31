import {
  approversOf,
  canSeeNotificationSubject,
  DomainError,
  memberTeamIds,
  type Principal,
  recipientPrincipal,
  type Team,
  TEST_NOTIFICATION_INTERVAL_MS,
  type Work,
  type WorkPermissionGrant,
} from "@mf100/domain";
import type { AppContext, Notification, NotificationKind } from "../ports.ts";

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body: string;
  workId?: string;
  revisionId?: string;
  threadId?: string;
  /**
   * 端末の通知に載せる抜粋（コメントの冒頭など）。本文の抜粋と同じもの。確認観点・理由・締切などは渡さない。
   * 見られない人の通知には保存しない
   */
  preview?: string;
}

/*
 * 通知の文面の型（UI_M3E §35 W-14）:
 * - 題名は「何が起きたか」の決まった文言（例「新しいコメント」）。制作物名などの変わる値は入れない
 * - 本文は「どの制作物の・どの版で・誰が」を先頭に置き、続けて抜粋や次の行動を書く
 *   例「『夏のポスター』第2版・山田さん: 3 行目の誤字…」
 */

/** 本文に入れる抜粋。改行・連続空白をつめ、長ければ切って「…」を付ける */
export function excerpt(text: string, max = 120): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

const weekdays = ["日", "月", "火", "水", "木", "金", "土"] as const;
/** 締切の日付（JST）: 「11/14（土）」 */
export function jstMonthDay(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${weekdays[d.getUTCDay()]}）`;
}

/** 「誰が」: 表示名に「さん」を付ける。分からなければ null */
export async function personName(ctx: AppContext, userId: string): Promise<string | null> {
  const name = await ctx.people.displayName(userId).catch(() => null);
  return name ? `${name}さん` : null;
}

/** 本文の頭: 「夏のポスター」第2版・山田さん（版・人は無ければ省く） */
export function about(workTitle: string, revision?: string | null, who?: string | null): string {
  return [`「${workTitle}」${revision ?? ""}`, who].filter(Boolean).join("・");
}

/**
 * 見られない制作物の通知に出す文面（§5.2-10）。題名・本文とも作品名・版・締切・確認観点などを含めない。
 * 種類（kind）だけは残す（何の知らせかは分かるが、どの制作物かは分からない）。
 */
export const REDACTED_NOTIFICATION = {
  title: "閲覧できない制作物の通知です",
  body: "この制作物を見る権限がありません。必要なら管理者に閲覧権限を依頼してください。",
} as const;

/**
 * 旧 FB（フィードバック）の通知か。FB はコメントへ移した（利用者決定 2026-10-20）ので新しくは作らないが、
 * 既に届いている通知は残る。その threadId は FB のスレッドなので、読むときに移し先のコメントへ付け替える
 */
export function isFeedbackNotificationKind(kind: NotificationKind): boolean {
  return kind === "feedback_posted" || kind === "feedback_mentioned";
}

/** 見られない人に返す形: 文面を伏せ、制作物・版・スレッドへの手がかり（ID）も返さない */
function redact(n: Notification): Notification {
  const { workId, revisionId, threadId, actorId, preview, ...rest } = n;
  void workId;
  void revisionId;
  void threadId;
  void actorId;
  void preview;
  return { ...rest, ...REDACTED_NOTIFICATION };
}

/** 削除されたコメントの通知に出す文面。元の本文・抜粋は伏せ、コメントへの手がかり（ID）も返さない */
export const DELETED_COMMENT_NOTIFICATION = { body: "削除されたコメントの通知です" } as const;

/**
 * 通知の先のコメントが削除されたか（スレッドごとに 1 回だけ読む）。
 * 削除したコメントは一覧からも消える（紙面に印もカードも無い。返信のために残すこともしない）。
 */
function deletedThreadLoader(ctx: AppContext) {
  const cache = new Map<string, Promise<boolean>>();
  return (n: Pick<Notification, "kind" | "threadId">): Promise<boolean> => {
    if (n.threadId === undefined) return Promise.resolve(false);
    let hit = cache.get(n.threadId);
    if (!hit) {
      hit = ctx.threads
        .findById(n.threadId)
        .then((t) => t !== null && t !== undefined && t.deletedAt !== undefined)
        .catch(() => false);
      cache.set(n.threadId, hit);
    }
    return hit;
  };
}

/** 削除されたコメントの通知に変える（文面・抜粋を伏せ、消えたコメントへは飛ばさない） */
function degradeDeletedComment(n: Notification): Notification {
  const { preview, threadId, ...rest } = n;
  void [preview, threadId];
  return { ...rest, ...DELETED_COMMENT_NOTIFICATION };
}

type LoadedSubject = { work: Work; grants: WorkPermissionGrant[]; teams: Team[] } | null;

/**
 * 通知の対象の制作物と ACL を読む（同じ制作物は 1 回だけ）。消えた制作物は null（見られない扱い）。
 * 非公開の制作物は、受信者の担当の所属で見られるかを判定するために担当の一覧も読む（1 回だけ）
 */
function subjectLoader(ctx: AppContext) {
  const cache = new Map<string, Promise<LoadedSubject>>();
  return (workId: string): Promise<LoadedSubject> => {
    let hit = cache.get(workId);
    if (!hit) {
      hit = (async () => {
        const work = await ctx.works.findById(workId).catch(() => null);
        if (!work) return null;
        const grants = await ctx.acl.listByWork(work.id);
        return { work, grants, teams: [] };
      })();
      cache.set(workId, hit);
    }
    return hit;
  };
}

/**
 * 複数の受信者にアプリ内通知を作る。本人（actor）には送らない。重複受信者は 1 回。
 * 制作物に関する通知は、受信者がその制作物を今見られるかを確かめ、
 * 見られない人には文面を伏せた通知（REDACTED_NOTIFICATION）を作る（§5.2-10）。
 * 例: 非公開の制作物に、職責・閲覧 ACL・関係者・担当の所属の無い人を校正者に割り当てた（割当は ACL を自動で付与しない・D3）。
 * 通常の制作物は委員なら誰でも見られる（WorkViewPolicy）ので伏せない。
 * 通知の失敗は業務更新を失敗させない（§10-4）ため、呼び出し側は await しても例外を業務に伝播させない。
 */
export async function notify(
  ctx: AppContext,
  recipients: Iterable<string>,
  actorId: string | null,
  input: NotifyInput,
): Promise<number> {
  const now = ctx.clock.now();
  let loaded: LoadedSubject | undefined;
  let count = 0;
  for (const recipientId of new Set(recipients)) {
    if (!recipientId || recipientId === actorId) continue;
    try {
      let visible = true;
      if (input.workId !== undefined) {
        if (loaded === undefined) loaded = await subjectLoader(ctx)(input.workId);
        visible =
          loaded !== null &&
          canSeeNotificationSubject("work", {
            work: loaded.work,
            grants: loaded.grants,
            principal: recipientPrincipal(recipientId, memberTeamIds(loaded.teams, recipientId)),
          });
      }
      const n: Omit<Notification, "id"> = {
        recipientId,
        kind: input.kind,
        title: visible ? input.title : REDACTED_NOTIFICATION.title,
        body: visible ? input.body : REDACTED_NOTIFICATION.body,
        createdAt: now,
      };
      // 誰が（端末の通知に出す）と抜粋。見られない人には保存しない
      if (visible && actorId) n.actorId = actorId;
      if (visible && input.preview) n.preview = excerpt(input.preview);
      // ID は保存しておく（後で閲覧権限が付けば読取時に辿れる）。見られない間は読取時に返さない
      if (input.workId !== undefined) n.workId = input.workId;
      if (input.revisionId !== undefined) n.revisionId = input.revisionId;
      if (input.threadId !== undefined) n.threadId = input.threadId;
      await ctx.notifications.insert(n);
      count++;
    } catch {
      // 通知の失敗で業務処理を止めない
    }
  }
  return count;
}

/** テスト通知の文面（§112） */
export const TEST_NOTIFICATION = {
  title: "テスト通知",
  body: "通知の設定から送ったテストです。この通知が届いていれば、この経路は使えます。",
} as const;

/** 1 分以内に送ったテスト通知を探す範囲（新しい順）。この間に通知が多く届いて外れても、テストがもう 1 件届くだけ */
const RECENT_FOR_TEST_LIMIT = 20;

/**
 * 本人宛にテスト通知を 1 件作る（§112）。本物の通知と同じ insert を通すので、外への配信も同じく予約される。
 * notify は使わない: 送り主（本人）には送らず、失敗も握りつぶすため。
 * 前のテストから TEST_NOTIFICATION_INTERVAL_MS たっていなければ test_notification_too_soon
 */
export async function sendTestNotification(
  ctx: AppContext,
  principal: Principal,
): Promise<Notification> {
  const now = ctx.clock.now();
  const recent = await ctx.notifications.listForUser(principal.userId, RECENT_FOR_TEST_LIMIT);
  const last = recent.find((n) => n.kind === "test");
  if (last && now - last.createdAt < TEST_NOTIFICATION_INTERVAL_MS)
    throw new DomainError("test_notification_too_soon", {
      retryAfterMs: TEST_NOTIFICATION_INTERVAL_MS - (now - last.createdAt),
    });
  return ctx.notifications.insert({
    recipientId: principal.userId,
    kind: "test",
    ...TEST_NOTIFICATION,
    createdAt: now,
  });
}

/**
 * 通知を読む人に返す形にする。作った後に ACL が取り消された・制作物が消えた等で今は見られない通知は、
 * 文面と ID を伏せて返す（§5.2-10。作成時の判定だけに頼らない）。
 */
export async function presentNotifications(
  ctx: AppContext,
  principal: Principal,
  notifications: readonly Notification[],
): Promise<Notification[]> {
  const load = subjectLoader(ctx);
  const deleted = deletedThreadLoader(ctx);
  const out: Notification[] = [];
  for (const n of notifications) {
    if (n.workId === undefined) {
      out.push(n);
      continue;
    }
    const loaded = await load(n.workId);
    const visible =
      loaded !== null &&
      canSeeNotificationSubject("work", {
        work: loaded.work,
        grants: loaded.grants,
        principal,
      });
    if (!visible) {
      out.push(redact(n));
      continue;
    }
    const shown = isFeedbackNotificationKind(n.kind) ? await relinkFeedbackNotification(ctx, n) : n;
    out.push((await deleted(shown)) ? degradeDeletedComment(shown) : shown);
  }
  return out;
}

/**
 * 旧 FB の通知を、移し先のコメントへ付け替える（threadId・revisionId を移し先のものにする。通知を押すと /revisions/{版}?thread={コメント} が開く）。
 * 移していない（移行前・移せなかった・削除済み）FB の通知は、行き先を持たない形にする（FB のスレッドの ID を、コメントの ID として扱わせない）
 */
async function relinkFeedbackNotification(ctx: AppContext, n: Notification): Promise<Notification> {
  const migrated = n.threadId ? await ctx.threads.findByMigratedFrom(n.threadId) : null;
  if (migrated) return { ...n, threadId: migrated.id, revisionId: migrated.revisionId };
  const { workId, revisionId, threadId, ...rest } = n;
  void [workId, revisionId, threadId];
  return rest;
}

export async function listMyNotifications(
  ctx: AppContext,
  principal: Principal,
  limit = 50,
): Promise<Notification[]> {
  return presentNotifications(
    ctx,
    principal,
    await ctx.notifications.listForUser(principal.userId, limit),
  );
}

export async function markNotificationRead(
  ctx: AppContext,
  principal: Principal,
  id: string,
): Promise<void> {
  const n = await ctx.notifications.findById(id);
  if (!n || n.recipientId !== principal.userId)
    throw new DomainError("forbidden", { notificationId: id });
  if (n.readAt !== undefined) return;
  await ctx.notifications.update({ ...n, readAt: ctx.clock.now() });
}

/** 既読を取り消して未読に戻す（利用者要望 2026-10-30・中嶋さん） */
export async function markNotificationUnread(
  ctx: AppContext,
  principal: Principal,
  id: string,
): Promise<void> {
  const n = await ctx.notifications.findById(id);
  if (!n || n.recipientId !== principal.userId)
    throw new DomainError("forbidden", { notificationId: id });
  if (n.readAt === undefined) return;
  const { readAt: _removed, ...rest } = n;
  void _removed;
  await ctx.notifications.update(rest);
}

/** 「すべて既読」の 1 回分の結果。hasMore なら asOf を渡して続きを呼ぶ */
export interface MarkAllReadResult {
  marked: number;
  hasMore: boolean;
  /** 押した時刻。これより後に届いた通知は既読にしない */
  asOf: number;
}

/** 1 回（1 トランザクション）で既読にする上限。Convex の書込み上限に収めるため */
export const MARK_ALL_READ_BATCH = 200;

/**
 * 未読の索引から asOf 以前の未読を最大 batchSize 件だけ既読にする。
 * 既読を含む最新 N 件を読む方式だと、N 件より古い未読に永久に届かない（レビュー指摘）ため未読だけを読む。
 * 続きがあれば hasMore=true（呼出側が同じ asOf で再度呼ぶ。Convex ではスケジューラで続ける）。
 */
export async function markUnreadNotificationsRead(
  ctx: AppContext,
  recipientId: string,
  asOf: number,
  batchSize = MARK_ALL_READ_BATCH,
): Promise<MarkAllReadResult> {
  const now = ctx.clock.now();
  const unread = await ctx.notifications.listUnreadForUser(recipientId, {
    createdAtOrBefore: asOf,
    limit: batchSize + 1,
  });
  let marked = 0;
  for (const n of unread.slice(0, batchSize)) {
    await ctx.notifications.update({ ...n, readAt: now });
    marked++;
  }
  return { marked, hasMore: unread.length > batchSize, asOf };
}

export async function markAllNotificationsRead(
  ctx: AppContext,
  principal: Principal,
  batchSize = MARK_ALL_READ_BATCH,
): Promise<MarkAllReadResult> {
  return markUnreadNotificationsRead(ctx, principal.userId, ctx.clock.now(), batchSize);
}

/** 作品の職責者（制作者・主管・校了者）。通知の既定の宛先。 */
export function workStakeholders(work: {
  creatorIds: readonly string[];
  managerIds: readonly string[];
  approverId: string;
  approverIds?: readonly string[] | undefined;
}): string[] {
  return [...work.creatorIds, ...work.managerIds, ...approversOf(work)];
}
