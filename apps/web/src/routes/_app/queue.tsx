import { api } from "@mf100/convex/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { formatJstDate, remaining } from "@/lib/format";
import { assignmentLabel } from "@/lib/labels";
import { StatusChip, StatusText } from "@/ui/Chip";
import { M3eFilterChip, M3eFilterChipSet, M3eIcon } from "@/ui/m3e";
import { PageHeader } from "@/ui/PageHeader";

export const Route = createFileRoute("/_app/queue")({ component: Queue });

const assignmentTone = {
  pending: "primary",
  viewed: "neutral",
  responded: "success",
  excused: "neutral",
} as const;

/**
 * U-01 自分の校正待ち。締切が近い順。
 * 表現: 期限超過は行ごと error コンテナで強調、確認完了・受付終了は沈める（M3E: 強調は業務上の意味に結び付ける）。
 */
function Queue() {
  const items = useQuery(api.reviews.myQueue, {});
  const [showDone, setShowDone] = useState(false);
  if (items === undefined) return <p className="muted">読み込み中…</p>;
  const pending = items.filter((i) => i.isOpen && i.assignmentState !== "responded");
  const visible = items.filter((i) => showDone || (i.isOpen && i.assignmentState !== "responded"));
  return (
    <>
      <PageHeader
        title="校正待ち"
        meta={
          <span
            className={`count ${pending.length === 0 ? "count--zero" : ""}`}
            aria-label="未確認の件数"
          >
            {pending.length}
          </span>
        }
      >
        <M3eFilterChipSet>
          <M3eFilterChip selected={showDone} onClick={() => setShowDone((v) => !v)}>
            確認済み・受付終了も表示
          </M3eFilterChip>
        </M3eFilterChipSet>
      </PageHeader>
      {visible.length === 0 ? (
        <div className="empty">
          <M3eIcon name="task_alt" />
          {items.length === 0 ? "割り当てられた校正はありません。" : "未確認の校正はありません。"}
        </div>
      ) : (
        <div className="table-wrap" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th>制作物</th>
                <th>締切</th>
                <th>状態</th>
                <th>指摘</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => {
                const done = !i.isOpen || i.assignmentState === "responded";
                return (
                  <tr
                    key={i.revisionId}
                    className={i.overdue && i.isOpen ? "row--urgent" : done ? "row--done" : ""}
                  >
                    <td>
                      <Link to="/revisions/$revisionId" params={{ revisionId: i.revisionId }}>
                        {i.workTitle}
                        {"　"}
                        {i.revisionLabel}
                      </Link>
                      {i.kind === "rough" ? <span className="meta ml">ラフ</span> : null}
                      {i.focusNotes ? <div className="small muted">{i.focusNotes}</div> : null}
                    </td>
                    <td>
                      <div>{formatJstDate(i.deadlineAt)}</div>
                      {i.isOpen ? (
                        <StatusText tone={i.overdue ? "error" : "neutral"}>
                          {remaining(i.deadlineAt)}
                        </StatusText>
                      ) : (
                        <span className="small muted">
                          {i.reviewState === "open" ? "期限超過" : "受付終了"}
                        </span>
                      )}
                    </td>
                    <td>
                      <StatusChip tone={assignmentTone[i.assignmentState]}>
                        {assignmentLabel[i.assignmentState]}
                      </StatusChip>
                    </td>
                    <td className="small">{i.totalCommentCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
