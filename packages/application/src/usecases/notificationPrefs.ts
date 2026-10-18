import {
  normalizeNotificationPrefs,
  type NotificationPrefs,
  type Principal,
  validateNotificationPrefsPatch,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";

/*
 * 通知の受け取り方（利用者ごと。端末への通知にだけ効く）。利用者指示 2026-10-18。
 * 自分の設定だけを読み書きする。行が無ければ既定（内容を表示・止めている分類なし）。
 */

export async function getNotificationPrefs(
  ctx: AppContext,
  principal: Principal,
): Promise<NotificationPrefs> {
  return normalizeNotificationPrefs(await ctx.notificationPrefs.find(principal.userId));
}

/** 渡した項目だけを変える（showPreview・mutedCategories のどちらか、または両方） */
export async function updateNotificationPrefs(
  ctx: AppContext,
  principal: Principal,
  patch: { showPreview?: boolean; mutedCategories?: readonly string[] },
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
