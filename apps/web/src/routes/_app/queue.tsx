import { api } from "@mf100/convex/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { formatJst, remaining } from "@/lib/format";
import { assignmentLabel, mediaLabel } from "@/lib/labels";
import { StatusChip } from "@/ui/Chip";
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
          {items.length === 0
            ? "あなたに割り当てられた校正はありません。割当は制作統括・制作者が版ごとに行います。"
            : "受付中かつ未確認の校正はありません。"}
        </div>
      ) : (
        <div className="table-wrap" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th>締切（JST）</th>
                <th>制作物</th>
                <th>版</th>
                <th>用途</th>
                <th>見てほしい点</th>
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
                      <div>{formatJst(i.deadlineAt)}</div>
                      {i.isOpen ? (
                        <StatusChip
                          tone={i.overdue ? "error" : "neutral"}
                          icon={i.overdue ? "warning" : "schedule"}
                        >
                          {remaining(i.deadlineAt)}
                        </StatusChip>
                      ) : (
                        <span className="small muted">
                          {i.reviewState === "open" ? "期限超過" : "受付終了"}
                        </span>
                      )}
                    </td>
                    <td>
                      <Link to="/works/$workId" params={{ workId: i.workId }}>
                        {i.workTitle}
                      </Link>
                      <div className="small muted">
                        {i.category}・{mediaLabel[i.mediaType]}
                      </div>
                    </td>
                    <td>
                      <Link to="/revisions/$revisionId" params={{ revisionId: i.revisionId }}>
                        {i.revisionLabel}
                      </Link>
                      {i.kind === "rough" ? (
                        <div>
                          <StatusChip tone="warning">ラフ</StatusChip>
                        </div>
                      ) : null}
                    </td>
                    <td className="small">{i.reviewType}</td>
                    <td className="small">{i.focusNotes || "—"}</td>
                    <td>
                      <StatusChip tone={assignmentTone[i.assignmentState]}>
                        {assignmentLabel[i.assignmentState]}
                      </StatusChip>
                    </td>
                    <td className="small">
                      自分 {i.myCommentCount} / 全 {i.totalCommentCount}
                    </td>
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
