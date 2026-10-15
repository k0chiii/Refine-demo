import { api } from "@mf100/convex/api";
import type { Anchor } from "@mf100/domain";
import { useQuery } from "convex/react";
import { formatJstCompact } from "@/lib/format";
import { UserAvatar } from "@/ui/UserAvatar";
import { M3eActionList, M3eIcon, M3eListAction } from "@/ui/m3e";
import { anchorPlace } from "./FeedbackPane";

/**
 * フィードバック（相談）のスレッドの一覧。全画面の一覧と、広い画面の一覧・詳細（list-detail）の左ペインで使う。
 * 行の先頭は最後に書いた人のアバター（行の頭を揃える）。未読は題名の強調と末尾の点（2 つの手がかり）。
 * 上の小見出しは制作物と、版の上の相談ならその版と場所。
 */
export function FeedbackThreadList({
  work,
  mine,
  unreadOnly,
  selectedId,
  onOpen,
}: {
  work?: string;
  mine: boolean;
  unreadOnly: boolean;
  selectedId?: string;
  onOpen: (id: string) => void;
}) {
  const all = useQuery(api.feedback.listThreads, {
    ...(work ? { workId: work } : {}),
    ...(mine ? { mine: true } : {}),
  });
  const threads = unreadOnly ? all?.filter((t) => t.unread) : all;
  if (threads === undefined) return <p className="muted fb-list__empty">読み込み中…</p>;
  if (threads.length === 0)
    return (
      <div className="empty fb-list__empty">
        <M3eIcon name="forum" />
        <span className="title-medium">
          {unreadOnly ? "未読のスレッドはありません" : "まだスレッドがありません"}
        </span>
        {unreadOnly ? null : (
          <span className="muted">
            制作物を開いて「FB」から、または紙面の範囲を選んで「FB」を選ぶと始められます
          </span>
        )}
      </div>
    );
  return (
    <M3eActionList className="list fb-list" aria-label="スレッド">
      {threads.map((t) => {
        const place = anchorPlace(t.anchor as Anchor | null);
        const where = [t.revision?.label, place].filter(Boolean).join("・");
        return (
          <M3eListAction
            key={t.id}
            className={`list__item fb-list__item ${t.unread ? "list__item--unread" : ""} ${
              t.id === selectedId ? "fb-list__item--selected" : ""
            }`}
            {...(t.id === selectedId ? { "aria-current": "true" } : {})}
            onClick={() => onOpen(t.id)}
          >
            <span slot="leading" className="fb-list__avatar" aria-hidden="true">
              <UserAvatar seed={t.lastPost?.author.id ?? t.createdBy.id} size={40} />
            </span>
            <span slot="overline">
              {t.workTitle}
              {t.confidentiality === "restricted" ? "（非公開）" : ""}
              {where ? `・${where}` : ""}
            </span>
            <span className="list__headline">{t.title}</span>
            <span slot="supporting-text">
              {t.lastPost ? `${t.lastPost.authorName}: ${t.lastPost.excerpt}` : ""}
            </span>
            <span slot="trailing" className="fb-list__trailing">
              <span className="fb-list__time">{formatJstCompact(t.lastPostAt)}</span>
              {t.unread ? <span className="fb-list__dot" role="img" aria-label="未読" /> : null}
            </span>
          </M3eListAction>
        );
      })}
    </M3eActionList>
  );
}
