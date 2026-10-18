import {
  approversOf,
  canSeeNotificationSubject,
  DomainError,
  memberTeamIds,
  type NotificationSubject,
  type Principal,
  recipientPrincipal,
  type Team,
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

/** 通知の種類 → 守る保護情報の種類。feedback_* はフィードバックの閲覧権限、それ以外は制作物の閲覧権限 */
export function notificationSubjectOf(kind: NotificationKind): NotificationSubject {
  return kind === "feedback_posted" || kind === "feedback_mentioned" ? "feedback" : "work";
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

type LoadedSubject = { work: Work; grants: WorkPermissionGrant[]; teams: Team[] } | null;

/**
 * 通知の対象の制作物と ACL を読む（同じ制作物は 1 回だけ）。消えた制作物は null（見られない扱い）。
 * 非公開の制作物は、受信者の担当の所属で見られるかを判定するために担当の一覧も読む（1 回だけ）
 */
function subjectLoader(ctx: AppContext) {
  const cache = new Map<string, Promise<LoadedSubject>>();
  let teams: Promise<Team[]> | undefined;
  return (workId: string): Promise<LoadedSubject> => {
    let hit = cache.get(workId);
    if (!hit) {
      hit = (async () => {
        const work = await ctx.works.findById(workId).catch(() => null);
        if (!work) return null;
        const grants = await ctx.acl.listByWork(work.id);
        if (work.confidentiality !== "restricted") return { work, grants, teams: [] };
        teams ??= ctx.teams.list();
        return { work, grants, teams: await teams };
      })();
      cache.set(workId, hit);
    }
    return hit;
  };
}

/**
 * 複数の受信者にアプリ内通知を作る。本人（actor）には送らない。重複受信者は 1 回。
 * 制作物に関する通知は、受信者がその制作物（feedback_* はフィードバック）を今見られるかを確かめ、
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
  const subject = notificationSubjectOf(input.kind);
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
          canSeeNotificationSubject(subject, {
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
  const out: Notification[] = [];
  for (const n of notifications) {
    if (n.workId === undefined) {
      out.push(n);
      continue;
    }
    const loaded = await load(n.workId);
    const visible =
      loaded !== null &&
      canSeeNotificationSubject(notificationSubjectOf(n.kind), {
        work: loaded.work,
        grants: loaded.grants,
        principal,
      });
    out.push(visible ? n : redact(n));
  }
  return out;
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
