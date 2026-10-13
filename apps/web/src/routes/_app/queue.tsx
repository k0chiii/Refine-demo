import { api } from "@mf100/convex/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { formatJstDate, remaining } from "@/lib/format";
import { assignmentLabel } from "@/lib/labels";
import { M3eActionList, M3eFilterChip, M3eFilterChipSet, M3eListAction } from "@/ui/m3e";
import { PageHeader } from "@/ui/PageHeader";

export const Route = createFileRoute("/_app/queue")({ component: Queue });

/**
 * U-01 自分の校正待ち。締切が近い順。
 * Gmail と同じ 2 行のリスト（m3e-action-list）: 1 行目は制作物と版、2 行目は締切と指摘数。
 * 色を付けるのは期限超過だけ。
 */
function Queue() {
  const items = useQuery(api.reviews.myQueue, {});
  const navigate = useNavigate();
  const [showDone, setShowDone] = useState(false);
  if (items === undefined) return <p className="muted">読み込み中…</p>;
  const visible = items.filter((i) => showDone || (i.isOpen && i.assignmentState !== "responded"));
  return (
    <>
      <PageHeader title="校正待ち">
        <M3eFilterChipSet>
          <M3eFilterChip selected={showDone} onClick={() => setShowDone((v) => !v)}>
            確認済みも表示
          </M3eFilterChip>
        </M3eFilterChipSet>
      </PageHeader>
      {visible.length === 0 ? (
        <div className="empty">
          {items.length === 0 ? "割り当てられた校正はありません。" : "未確認の校正はありません。"}
        </div>
      ) : (
        <M3eActionList className="list" aria-label="校正待ち">
          {visible.map((i) => {
            const done = !i.isOpen || i.assignmentState === "responded";
            const urgent = i.overdue && i.isOpen;
            return (
              <M3eListAction
                key={i.revisionId}
                className={`list__item ${done ? "list__item--done" : ""} ${urgent ? "list__item--urgent" : ""}`}
                onClick={() =>
                  void navigate({
                    to: "/revisions/$revisionId",
                    params: { revisionId: i.revisionId },
                  })
                }
              >
                <span className="list__headline">
                  {i.workTitle}
                  <span className="muted">　{i.revisionLabel}</span>
                  {i.kind === "rough" ? <span className="muted">　ラフ</span> : null}
                </span>
                <span slot="supporting-text">
                  {i.isOpen
                    ? `締切 ${formatJstDate(i.deadlineAt)}（${remaining(i.deadlineAt)}）`
                    : i.reviewState === "open"
                      ? "期限超過"
                      : "受付終了"}
                  {i.totalCommentCount > 0 ? `・指摘 ${i.totalCommentCount}` : ""}
                  {i.focusNotes ? `・${i.focusNotes}` : ""}
                </span>
                <span slot="trailing" className={`meta ${urgent ? "meta--error" : ""}`}>
                  {urgent ? "期限超過" : assignmentLabel[i.assignmentState]}
                </span>
              </M3eListAction>
            );
          })}
        </M3eActionList>
      )}
    </>
  );
}
