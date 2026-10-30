import { api } from "@mf100/convex/api";
import { ACCOUNT_CHANNELS } from "@mf100/domain";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo } from "react";
import { usePushAvailable } from "./useDevicePush";

/** 自分の通知の設定と、届け先（Nogiku のメールアドレス・Slack（DM））ごとの状態 */
export type NotificationSettingsView = FunctionReturnType<typeof api.notificationPrefs.get>;

/** サーバーの無いデモ。env が無いので届け先は使えないことになるが、端末への通知と同じく行を出して設定を試せるようにする */
const DEMO = import.meta.env.MODE === "demo";

/** 通知の設定（サインイン前は問い合わせない: enabled: false） */
export function useNotificationSettings(enabled: boolean): NotificationSettingsView | undefined {
  const settings = useQuery(api.notificationPrefs.get, enabled ? {} : "skip");
  return useMemo(
    () =>
      DEMO && settings
        ? {
            ...settings,
            destinations: {
              email: { ...settings.destinations.email, available: true },
              slack: { ...settings.destinations.slack, available: true },
            },
          }
        : settings,
    [settings],
  );
}

/** アカウントのメニューに「通知の設定」を出すか: この端末への通知が使えるか、メール・Slack のどれかが使える（§103） */
export function settingsMenuVisible(input: {
  pushUsable: boolean;
  settings: NotificationSettingsView | undefined;
}): boolean {
  const { pushUsable, settings } = input;
  return pushUsable || ACCOUNT_CHANNELS.some((c) => settings?.destinations[c].available === true);
}

export function useNotificationSettingsAvailable(enabled: boolean): boolean {
  const pushUsable = usePushAvailable(enabled);
  const settings = useNotificationSettings(enabled);
  return settingsMenuVisible({ pushUsable, settings });
}
