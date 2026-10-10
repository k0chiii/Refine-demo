import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { formatJst } from "@/lib/format";
import { notificationKindLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { M3eButton, M3eIcon } from "@/ui/m3e";

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

/** アプリ内通知（F-11 最小通知 / D8）。Slack 等への外部送信は行わない。 */
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
      <h1 className="page-title">
        通知
        {unread > 0 ? <span className="chip chip--primary">未読 {unread}</span> : null}
        <span className="spacer" />
        <M3eButton
          variant="text"
          disabled={unread === 0 || doMarkAll.pending}
          onClick={() => void doMarkAll.run()}
        >
          <M3eIcon slot="icon" name="done_all" />
          すべて既読にする
        </M3eButton>
      </h1>
      <p className="small muted">
        自分が関わる制作物の提出・割当・指摘・採否・専門確認・期限接近・校了をここに表示します。本人の操作は通知されません。Slack
        連携は後続（D8）。
      </p>
      {list.length === 0 ? (
        <div className="empty">通知はありません。</div>
      ) : (
        <div className="stack">
          {list.map((n) => (
            <article
              key={n.id}
              className={`notification ${n.readAt === undefined ? "notification--unread" : ""}`}
              tabIndex={0}
              role="button"
              onClick={() => void openOne.run(n)}
              onKeyDown={(e) => e.key === "Enter" && void openOne.run(n)}
            >
              <M3eIcon name={icon[n.kind] ?? "notifications"} />
              <div>
                <div className="row">
                  <span className="chip">{notificationKindLabel[n.kind] ?? n.kind}</span>
                  <strong>{n.title}</strong>
                </div>
                <div className="small">{n.body}</div>
              </div>
              <span className="small muted">{formatJst(n.createdAt)}</span>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
