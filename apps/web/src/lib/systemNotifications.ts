/*
 * 端末の通知（システムの通知）と、アプリの中の既読をそろえる。
 * アプリで読んだ通知（開いた・既読にした・すべて既読にした）の通知が端末に残らないように、既読になったものを閉じる。
 * 端末の通知には、Service Worker が data に通知の ID（id、まとめた通知は ids）を持たせている（pwa/sw.template.js）。
 */

/** 端末の通知の data から、含まれる通知の ID を取り出す（無ければ空） */
export function systemNotificationIds(data: unknown): string[] {
  const d = (data ?? {}) as { id?: unknown; ids?: unknown };
  const ids = Array.isArray(d.ids) ? d.ids : typeof d.id === "string" ? [d.id] : [];
  return ids.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * 端末の通知を閉じてよいか: 含まれる通知がすべて既読のとき（未読が 0 件ならすべて）。
 * 一覧の範囲（新しい順の一部）に無い通知は、既読とは分からないので閉じない。ID を持たない通知（確認用など）も閉じない
 */
export function shouldCloseSystemNotification(
  ids: readonly string[],
  readIds: ReadonlySet<string>,
  unread: number,
): boolean {
  if (ids.length === 0) return false;
  return unread === 0 || ids.every((id) => readIds.has(id));
}

/** 一覧から、既読の通知の ID の集合を作る */
export function readNotificationIds(
  list: ReadonlyArray<{ id: string; readAt?: number | undefined }>,
): Set<string> {
  return new Set(list.filter((n) => n.readAt !== undefined).map((n) => n.id));
}

/**
 * 既読になった通知を端末から閉じる。Service Worker が無い・対応していない環境では何もしない（失敗も無視する）。
 * 閉じた数を返す
 */
export async function closeReadSystemNotifications(
  list: ReadonlyArray<{ id: string; readAt?: number | undefined }>,
  unread: number,
): Promise<number> {
  try {
    if (!("serviceWorker" in navigator)) return 0;
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) return 0;
    const readIds = readNotificationIds(list);
    // 未読 0 件は、届いたばかりの通知が一覧にまだ載っていない間に誤って閉じないよう、一覧にも未読が無いときだけ使う
    const none = unread === 0 && list.every((n) => n.readAt !== undefined) ? 0 : 1;
    let closed = 0;
    for (const shown of await reg.getNotifications()) {
      if (!shouldCloseSystemNotification(systemNotificationIds(shown.data), readIds, none))
        continue;
      shown.close();
      closed++;
    }
    return closed;
  } catch {
    return 0;
  }
}
