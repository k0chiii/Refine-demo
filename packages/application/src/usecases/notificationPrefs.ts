import {
  type AccountChannel,
  type ChannelAvailability,
  type ChannelStatus,
  normalizeNotificationPrefs,
  type NotificationPrefs,
  type Principal,
  validateNotificationPrefsPatch,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";

/*
 * 通知の受け取り方（利用者ごと。外への通知に効く）。利用者指示 2026-10-18・2026-10-28。
 * 自分の設定だけを読み書きする。行が無ければ既定（内容を表示・止めている分類なし・メールと Slack はオフ）。
 */

/** 設定画面の届け先 1 つ */
export interface ChannelSetting {
  /** env が揃っている（web はデモで true に読み替える） */
  available: boolean;
  on: boolean;
  /** users.email（ここでは変えない）。無ければ null */
  address: string | null;
  status: ChannelStatus;
}

export interface NotificationSettings extends NotificationPrefs {
  /** 設定画面の届け先。ACCOUNT_CHANNELS から導く（Record なので経路を足すと画面の型が落ちる） */
  destinations: Record<AccountChannel, ChannelSetting>;
}

export async function getNotificationPrefs(
  ctx: AppContext,
  principal: Principal,
): Promise<NotificationPrefs> {
  return normalizeNotificationPrefs(await ctx.notificationPrefs.find(principal.userId));
}

/** 自分の設定と、届け先ごとの状態（設定画面が読む） */
export async function getNotificationSettings(
  ctx: AppContext,
  principal: Principal,
  available: ChannelAvailability,
): Promise<NotificationSettings> {
  void [ctx, principal, available];
  throw new Error("not implemented");
}

/**
 * 渡した項目だけを変える（showPreview・mutedCategories・channels）。
 * 使えない経路もオンにできる（意思として保存し、送るかは env が決める）
 */
export async function updateNotificationPrefs(
  ctx: AppContext,
  principal: Principal,
  patch: {
    showPreview?: boolean;
    mutedCategories?: readonly string[];
    channels?: readonly string[];
  },
): Promise<NotificationPrefs> {
  const valid = validateNotificationPrefsPatch(patch);
  const next = normalizeNotificationPrefs({
    ...(await getNotificationPrefs(ctx, principal)),
    ...valid,
  });
  await ctx.notificationPrefs.save({
    userId: principal.userId,
    ...next,
    updatedAt: ctx.clock.now(),
  });
  return next;
}
