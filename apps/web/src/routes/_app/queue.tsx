import { api } from "@mf100/convex/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { formatJst, remaining } from "@/lib/format";
import { assignmentLabel, mediaLabel } from "@/lib/labels";
import { M3eFilterChip, M3eFilterChipSet } from "@/ui/m3e";

export const Route = createFileRoute("/_app/queue")({ component: Queue });

/** U-01 自分の校正待ち。締切が近い順。未確認／確認済み／指摘有／期限超過を区別する。 */
function Queue() {
  const items = useQuery(api.reviews.myQueue, {});
  const [showDone, setShowDone] = useState(false);
  if (items === undefined) return <p className="muted">読み込み中…</p>;
  const visible = items.filter((i) => showDone || (i.isOpen && i.assignmentState !== "responded"));
  return (
    <>
      <h1 className="page-title">
        校正待ち{" "}
        <span className="chip chip--primary">
          {items.filter((i) => i.isOpen && i.assignmentState !== "responded").length} 件
        </span>
        <span className="spacer" />
        <M3eFilterChipSet>
          <M3eFilterChip selected={showDone} onClick={() => setShowDone((v) => !v)}>
            確認済み・受付終了も表示
          </M3eFilterChip>
        </M3eFilterChipSet>
      </h1>
      {visible.length === 0 ? (
        <div className="empty">
          {items.length === 0
            ? "あなたに割り当てられた校正はありません。割当は制作統括・制作者が版ごとに行います。"
            : "受付中かつ未確認の校正はありません。"}
        </div>
      ) : (
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
            {visible.map((i) => (
              <tr key={i.revisionId}>
                <td>
                  <div>{formatJst(i.deadlineAt)}</div>
                  <div className={`small ${i.overdue ? "chip chip--error" : "muted"}`}>
                    {i.isOpen
                      ? remaining(i.deadlineAt)
                      : i.reviewState === "open"
                        ? "期限超過"
                        : "受付終了"}
                  </div>
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
                  {i.kind === "rough" ? <div className="chip chip--warn">ラフ</div> : null}
                </td>
                <td className="small">{i.reviewType}</td>
                <td className="small">{i.focusNotes || "—"}</td>
                <td>
                  <span
                    className={`chip ${i.assignmentState === "pending" ? "chip--primary" : i.assignmentState === "responded" ? "chip--ok" : ""}`}
                  >
                    {assignmentLabel[i.assignmentState]}
                  </span>
                </td>
                <td className="small">
                  自分 {i.myCommentCount} / 全 {i.totalCommentCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
