import { DomainError } from "../shared/DomainError.ts";
import { validateSlackEmail } from "./slack.ts";

/*
 * 通知の受け取り方（利用者ごとの設定）。利用者指示 2026-10-18「アプリのプッシュ通知、もう少し普通のアプリみたいにしたい」、
 * 2026-10-28「登録メールアドレス、Slack（DM）に流れるようにしたい」。
 * 外への通知（端末・登録メールアドレス・Slack の DM）に効く。アプリ内の通知（ベルの一覧）は設定にかかわらず作られる。
 */

/** 通知を外に届ける経路（アプリ内の通知は別。常に作られる正本・§10-1） */
export const DELIVERY_CHANNELS = ["push", "email", "slack"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/**
 * アカウントで一度オンにする経路。宛先はアカウント（users.email）から決まり、利用者は原則入力しない
 * （Slack だけ、プロフィールのメールが違えば Slack のメールアドレスを書ける。§110）。push は端末ごと
 */
export const ACCOUNT_CHANNELS = ["email", "slack"] as const satisfies readonly DeliveryChannel[];
export type AccountChannel = (typeof ACCOUNT_CHANNELS)[number];

/** 通知の分類（設定でオン・オフする単位） */
export const NOTIFICATION_CATEGORIES = [
  "mention", // メンション
  "reply", // 返信・コメント
  "assignment", // 割当・確認依頼
  "deadline", // 期限・リマインド
  "rule", // 表記ルールの提案
  "other", // その他
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * 通知の種類（kind）→ 分類。notify に渡す kind はすべてここに載せる（テストで確かめる）。
 * - mention: 自分が名指しされた
 * - reply: 自分の制作物・スレッドへのコメントや返信、その採否
 * - assignment: 自分への割当・専門確認の依頼
 * - deadline: 締切が近い
 * - rule: 表記ルールの提案とその結果
 * - other: 版の提出・無効、校了・再開、専門確認の完了、自動校正の終了、テスト通知（§112）
 */
export const NOTIFICATION_KIND_CATEGORY = {
  mentioned: "mention",
  feedback_mentioned: "mention",
  comment_posted: "reply",
  feedback_posted: "reply",
  comment_decided: "reply",
  review_assigned: "assignment",
  comment_assigned: "assignment",
  check_requested: "assignment",
  deadline_approaching: "deadline",
  rule_proposed: "rule",
  rule_proposal_decided: "rule",
  revision_submitted: "other",
  revision_voided: "other",
  work_finalized: "other",
  work_reopened: "other",
  check_completed: "other",
  auto_proofread_done: "other",
  test: "other",
} as const satisfies Record<string, NotificationCategory>;

/** 通知の種類 → 分類。知らない種類は「その他」 */
export function notificationCategoryOf(kind: string): NotificationCategory {
  const known = NOTIFICATION_KIND_CATEGORY as Record<string, NotificationCategory | undefined>;
  return known[kind] ?? "other";
}

export interface NotificationPrefs {
  /** 外への通知（端末・メール・Slack）に送り主と抜粋（と本文）を載せる（iOS の「プレビューを表示」にあたる） */
  showPreview: boolean;
  /** 外へ送らない分類（端末・メール・Slack に共通。アプリ内の通知は残る） */
  mutedCategories: NotificationCategory[];
  /** オンにしたアカウントの経路。既定は空（オプトイン） */
  channels: AccountChannel[];
  /** Slack（DM）の送り先のワークスペース（登録の id）。無ければ選んでいない */
  slackWorkspaceId?: string;
  /** Slack で引くアドレス（normalizeSlackEmail の形）。無ければ Nogiku のメールアドレスで引く（§110） */
  slackEmail?: string;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  showPreview: true,
  mutedCategories: [],
  channels: [],
};

/**
 * 保存された設定（無ければ既定）を、決まった形・順にそろえる。知らない分類・経路は捨てる。
 * ワークスペース・Slack のメールアドレスは空・null なら無いことにする（パッチの null で外れる）
 */
export function normalizeNotificationPrefs(
  input?: {
    showPreview?: boolean;
    mutedCategories?: readonly string[];
    channels?: readonly string[];
    slackWorkspaceId?: string | null;
    slackEmail?: string | null;
  } | null,
): NotificationPrefs {
  const muted = new Set(input?.mutedCategories ?? []);
  const channels = new Set(input?.channels ?? []);
  const slackWorkspaceId = input?.slackWorkspaceId?.trim();
  const slackEmail = input?.slackEmail?.trim();
  return {
    showPreview: input?.showPreview ?? DEFAULT_NOTIFICATION_PREFS.showPreview,
    mutedCategories: NOTIFICATION_CATEGORIES.filter((c) => muted.has(c)),
    channels: ACCOUNT_CHANNELS.filter((c) => channels.has(c)),
    ...(slackWorkspaceId ? { slackWorkspaceId } : {}),
    ...(slackEmail ? { slackEmail } : {}),
  };
}

/** Slack で引くアドレス（§110）: 各自が書いた Slack のメールアドレス、無ければ Nogiku のアドレス（deliverableEmail を通したもの） */
export function slackAddressOf(
  prefs: Pick<NotificationPrefs, "slackEmail">,
  nogikuEmail: string | null,
): string | null {
  return prefs.slackEmail ?? nogikuEmail;
}

/** 利用者が送ってきた設定の変更 */
export interface NotificationPrefsPatch {
  showPreview?: boolean;
  mutedCategories?: readonly string[];
  channels?: readonly string[];
  /** null で選択を外す */
  slackWorkspaceId?: string | null;
  /** null・空で消す（Nogiku のアドレスで引くのに戻る） */
  slackEmail?: string | null;
}

interface ValidPrefsPatch {
  showPreview?: boolean;
  mutedCategories?: NotificationCategory[];
  channels?: AccountChannel[];
  slackWorkspaceId?: string | null;
  slackEmail?: string | null;
}

/**
 * 利用者が送ってきた設定を確かめる（知らない分類・経路、空のワークスペース、形の違う Slack のメールアドレスは受け付けない）。
 * ワークスペースが登録にあるかは確かめない（application が確かめる）
 */
export function validateNotificationPrefsPatch(patch: NotificationPrefsPatch): ValidPrefsPatch {
  const out: ValidPrefsPatch = {};
  if (patch.showPreview !== undefined) out.showPreview = patch.showPreview === true;
  if (patch.mutedCategories !== undefined) {
    const known = new Set<string>(NOTIFICATION_CATEGORIES);
    if (patch.mutedCategories.some((c) => !known.has(c)))
      throw new DomainError("notification_prefs_invalid", { field: "mutedCategories" });
    out.mutedCategories = normalizeNotificationPrefs({
      mutedCategories: patch.mutedCategories,
    }).mutedCategories;
  }
  if (patch.channels !== undefined) {
    const known = new Set<string>(ACCOUNT_CHANNELS);
    if (patch.channels.some((c) => !known.has(c)))
      throw new DomainError("notification_prefs_invalid", { field: "channels" });
    out.channels = normalizeNotificationPrefs({ channels: patch.channels }).channels;
  }
  if (patch.slackWorkspaceId !== undefined) {
    const id = patch.slackWorkspaceId?.trim() ?? null;
    if (id === "")
      throw new DomainError("notification_prefs_invalid", { field: "slackWorkspaceId" });
    out.slackWorkspaceId = id;
  }
  if (patch.slackEmail !== undefined) out.slackEmail = validateSlackEmail(patch.slackEmail);
  return out;
}

/** この種類の通知を外へ送らない設定か。テスト通知は経路が使えるかを確かめるためのものなので止めない（§112） */
export function isCategoryMuted(prefs: NotificationPrefs, kind: string): boolean {
  if (kind === "test") return false;
  return prefs.mutedCategories.includes(notificationCategoryOf(kind));
}

/** テスト通知（§112）を 1 人が続けて送れる間隔。サーバーはこれで断り、画面はこの間ボタンを押せなくする */
export const TEST_NOTIFICATION_INTERVAL_MS = 60_000;
