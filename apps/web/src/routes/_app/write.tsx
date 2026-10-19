import { api } from "@mf100/convex/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { formatDeadline, formatJstShort } from "@/lib/format";
import { mediaLabel } from "@/lib/labels";
import { useWindowClass } from "@/lib/useMedia";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Loading } from "@/ui/Loading";
import { M3eIcon } from "@m3e/react/icon";
import { M3eActionList, M3eListAction } from "@m3e/react/list";

export const Route = createFileRoute("/_app/write")({ component: WritePicker });

/**
 * 新しく書く（制作の FAB「作る」から。利用者決定 2026-10-19: 書くはナビの行き先ではなく制作から入る。URL は従来どおり /write）:
 * 自分の担当で、いま書ける制作物を選んで文章エディタ（SNS は投稿エディタ）を開く。
 * 出るのは版を提出できる人（制作者・主管担当など）の進行中の制作物だけ。最近書いた下書きが上、次に締切の近い順。
 */
function WritePicker() {
  const navigate = useNavigate();
  const works = useQuery(api.documents.writable, {});
  // 狭い画面では種類・納期を右に置くと題名が 1 文字ずつ折れるので、説明の行にまとめる
  const compact = useWindowClass() === "compact";
  const open = (w: { workId: string; mediaType: string }) =>
    void navigate({
      to: w.mediaType === "sns" ? "/works/$workId/post" : "/works/$workId/write",
      params: { workId: w.workId },
    });
  const meta = (w: { mediaType: string; deadlineAt?: number | null }) =>
    `${mediaLabel[w.mediaType] ?? w.mediaType}${w.deadlineAt ? `・納期 ${formatDeadline(w.deadlineAt)}` : ""}`;
  return (
    <div className="write-picker">
      <AppBarSlot slot="title">新しく書く</AppBarSlot>
      <p className="muted small write-picker__lead">制作物を選んでください</p>
      {works === undefined ? (
        <Loading label="書ける制作物を読み込んでいます" />
      ) : works.length === 0 ? (
        <div className="empty">
          <M3eIcon name="edit_document" />
          いま書ける担当の制作物はありません。制作者・主管担当になっている進行中の制作物がここに出ます。
        </div>
      ) : (
        <M3eActionList className="list" aria-label="書ける制作物">
          {works.map((w) => (
            <M3eListAction key={w.workId} className="list__item" onClick={() => open(w)}>
              <M3eIcon
                slot="leading"
                name={w.mediaType === "sns" ? "post_add" : "edit_document"}
                className={w.draft ? "icon--filled" : ""}
              />
              <span className="list__headline">{w.title}</span>
              <span slot="supporting-text">
                {compact ? (
                  <>
                    {meta(w)}
                    <br />
                  </>
                ) : null}
                {w.draft
                  ? `下書き「${w.draft.title || "無題"}」・${w.draft.chars.toLocaleString("ja-JP")} 文字・${formatJstShort(w.draft.updatedAt)}${w.draft.updatedBy ? ` ${w.draft.updatedBy.name}` : ""}`
                  : "まだ下書きはありません"}
              </span>
              {compact ? null : (
                <span slot="trailing" className="meta">
                  {meta(w)}
                </span>
              )}
            </M3eListAction>
          ))}
        </M3eActionList>
      )}
    </div>
  );
}
