import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { formatJst } from "@/lib/format";
import { notificationKindLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { StatusChip } from "@/ui/Chip";
import { M3eActionList, M3eButton, M3eIcon, M3eListAction } from "@/ui/m3e";
import { PageHeader } from "@/ui/PageHeader";

export const Route = createFileRoute("/_app/notifications")({ component: Notifications });

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

/** アプリ内通知（F-11 最小通知 / D8）。M3E list（leading icon / overline / supporting text / trailing）。 */
function Notifications() {
  const navigate = useNavigate();
  const list = useQuery(api.notifications.list, { limit: 100 });
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
  if (list === undefined) return <p className="muted">読み込み中…</p>;
  const unread = list.filter((n) => n.readAt === undefined).length;
  return (
    <>
      <PageHeader
        title="通知"
        meta={
          <span className={`count ${unread === 0 ? "count--zero" : ""}`} aria-label="未読の件数">
            {unread}
          </span>
        }
      >
        <M3eButton
          variant="text"
          disabled={unread === 0 || doMarkAll.pending}
          onClick={() => void doMarkAll.run()}
        >
          <M3eIcon slot="icon" name="done_all" />
          すべて既読にする
        </M3eButton>
      </PageHeader>
      <p className="small muted" style={{ marginTop: 0 }}>
        自分が関わる制作物の提出・割当・指摘・採否・専門確認・期限接近・校了をここに表示します。本人の操作は通知されません。Slack
        連携は後続（D8）。
      </p>
      {list.length === 0 ? (
        <div className="empty">
          <M3eIcon name="notifications_off" />
          通知はありません。
        </div>
      ) : (
        <M3eActionList className="notification-list" aria-label="通知一覧">
          {list.map((n) => {
            const unreadOne = n.readAt === undefined;
            return (
              <M3eListAction
                key={n.id}
                className={`notification ${unreadOne ? "notification--unread" : "notification--read"}`}
                onClick={() => void openOne.run(n)}
              >
                <M3eIcon
                  slot="leading"
                  className="notification__icon"
                  name={icon[n.kind] ?? "notifications"}
                  style={unreadOne ? { fontVariationSettings: '"FILL" 1' } : undefined}
                />
                <span slot="overline">
                  <StatusChip tone={unreadOne ? "primary" : "neutral"}>
                    {notificationKindLabel[n.kind] ?? n.kind}
                  </StatusChip>
                </span>
                <span className={unreadOne ? "label-large" : ""}>{n.title}</span>
                <span slot="supporting-text">{n.body}</span>
                <span slot="trailing" className="small muted">
                  {formatJst(n.createdAt)}
                </span>
              </M3eListAction>
            );
          })}
        </M3eActionList>
      )}
    </>
  );
}
