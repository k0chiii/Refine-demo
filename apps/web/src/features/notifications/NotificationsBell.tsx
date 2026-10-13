import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { formatJstShort } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { M3eBadge, M3eIcon, M3eMenu, M3eMenuItem } from "@/ui/m3e";

const icon: Record<string, string> = {
  revision_submitted: "upload_file",
  review_assigned: "assignment_ind",
  comment_posted: "chat",
  comment_decided: "rule",
  comment_assigned: "person_pin",
  check_requested: "fact_check",
  check_completed: "task_alt",
  deadline_approaching: "alarm",
  work_finalized: "verified",
  work_reopened: "lock_open",
  revision_voided: "block",
};

/** アプリバーのベル。未読数のバッジ付きアイコン（`Icon`）と、押すと出る通知のパネル（`Menu`）。 */
function Icon() {
  const unread = useQuery(api.notifications.unreadCount, {}) ?? 0;
  return (
    <span className="nav-icon">
      <M3eIcon name="notifications" className={unread > 0 ? "icon--filled" : ""} />
      {unread > 0 ? (
        <M3eBadge size="large" className="nav-icon__badge" aria-label={`未読 ${unread} 件`}>
          {unread > 99 ? "99+" : unread}
        </M3eBadge>
      ) : null}
    </span>
  );
}

/**
 * 通知のパネル（F-11 最小通知 / D8）。独立した画面は持たない。
 * 押した通知は既読にして、対象（その版のエディタ）へ飛ぶ。
 */
function Menu({ id }: { id: string }) {
  const navigate = useNavigate();
  const list = useQuery(api.notifications.list, { limit: 20 });
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const doMarkAll = useAction(async () => {
    await markAllRead({});
  });
  const openOne = useAction(async (n: NonNullable<typeof list>[number]) => {
    if (n.readAt === undefined) await markRead({ notificationId: n.id as Id<"notifications"> });
    if (n.revisionId)
      void navigate({ to: "/revisions/$revisionId", params: { revisionId: n.revisionId } });
    else if (n.workId) void navigate({ to: "/works/$workId", params: { workId: n.workId } });
  });
  const unread = (list ?? []).filter((n) => n.readAt === undefined).length;
  return (
    <M3eMenu id={id} positionX="before" className="notif-menu">
      <div className="notif-menu__header">
        <span className="label-large">通知</span>
      </div>
      {unread > 0 ? (
        <M3eMenuItem disabled={doMarkAll.pending} onClick={() => void doMarkAll.run()}>
          <M3eIcon slot="icon" name="done_all" />
          すべて既読にする
        </M3eMenuItem>
      ) : null}
      {!list || list.length === 0 ? (
        <p className="muted small notif-menu__empty">通知はありません。</p>
      ) : (
        list.map((n) => (
          <M3eMenuItem
            key={n.id}
            className={`notif ${n.readAt === undefined ? "notif--unread" : ""}`}
            onClick={() => void openOne.run(n)}
          >
            <M3eIcon slot="icon" name={icon[n.kind] ?? "notifications"} />
            <span className="notif__body">
              <span className="notif__title">{n.title}</span>
              <span className="notif__sub">{n.body}</span>
              <span className="notif__time">{formatJstShort(n.createdAt)}</span>
            </span>
          </M3eMenuItem>
        ))
      )}
    </M3eMenu>
  );
}

export const NotificationsBell = { Icon, Menu };
