import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { setAppBadge } from "@/lib/pwa";
import { closeReadSystemNotifications } from "@/lib/systemNotifications";

/**
 * アプリの中の既読を、端末の通知とアイコンの数字にそろえる。シェルに 1 つだけ置く（描画しない）。
 * - 未読の数が変わるたびに、アプリのアイコンの数字を合わせる（非対応の環境では何もしない）
 * - 既読になった通知（開いた・既読にした・すべて既読）の、端末に残った通知を閉じる
 * 一覧の問い合わせは通知パネルと同じ引数で、購読を共有する
 */
export function useSystemNotificationSync(enabled: boolean) {
  const unread = useQuery(api.notifications.unreadCount, enabled ? {} : "skip") ?? 0;
  const list = useQuery(api.notifications.list, enabled ? { limit: 20 } : "skip");
  useEffect(() => setAppBadge(unread), [unread]);
  useEffect(() => {
    if (list) void closeReadSystemNotifications(list, unread);
  }, [list, unread]);
}
