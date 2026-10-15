import { api } from "@mf100/convex/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { NewThreadDialog } from "@/features/feedback/NewThreadDialog";
import { formatJstShort } from "@/lib/format";
import { useWindowClass } from "@/lib/useMedia";
import { AppBarSlot } from "@/ui/AppBarSlot";
import {
  M3eActionList,
  M3eButton,
  M3eFilterChip,
  M3eFilterChipSet,
  M3eIcon,
  M3eIconButton,
  M3eInputChip,
  M3eListAction,
} from "@/ui/m3e";

export const Route = createFileRoute("/_app/feedback/")({
  validateSearch: (s: Record<string, unknown>): { work?: string; new?: boolean } => ({
    ...(typeof s.work === "string" && s.work ? { work: s.work } : {}),
    ...(s.new === true || s.new === "true" ? { new: true } : {}),
  }),
  component: FeedbackList,
});

/**
 * フィードバック（制作の議論。利用者決定 2026-10-15: 表現の FB は Slack ではなく MF100 の中で、制作物ごとに話題別のスレッド。
 * 委員なら誰でも見て書ける。非公開の制作物は閲覧権限のある人だけ。版とは別）。
 * Slack のチャンネルのように、新しい投稿があったスレッドが上に来る。未読は点と太字。
 * 制作物で絞る（`work`。エディタの「フィードバック」から来る）・自分が関わるスレッドだけにする。
 */
function FeedbackList() {
  const { work, new: creating } = Route.useSearch();
  const navigate = useNavigate();
  const compact = useWindowClass() === "compact";
  const [mine, setMine] = useState(false);
  const threads = useQuery(api.feedback.listThreads, {
    ...(work ? { workId: work } : {}),
    ...(mine ? { mine: true } : {}),
  });
  const workTitle = work ? threads?.[0]?.workTitle : null;
  const setCreating = (on: boolean) =>
    void navigate({
      to: "/feedback",
      search: (s) => {
        const { new: _drop, ...rest } = s;
        return on ? { ...rest, new: true } : rest;
      },
      replace: !on,
    });

  return (
    <div className="feedback">
      <AppBarSlot slot="title">フィードバック</AppBarSlot>
      {compact ? (
        <AppBarSlot slot="actions">
          <M3eIconButton aria-label="スレッドを立てる" onClick={() => setCreating(true)}>
            <M3eIcon name="add_comment" />
          </M3eIconButton>
        </AppBarSlot>
      ) : null}
      <div className="feedback__controls">
        <M3eFilterChipSet aria-label="絞り込み">
          <M3eFilterChip selected={mine} onClick={() => setMine((v) => !v)}>
            自分が関わる
          </M3eFilterChip>
        </M3eFilterChipSet>
        {work ? (
          <M3eInputChip
            removable
            removeLabel="制作物の絞り込みを外す"
            onRemove={() => void navigate({ to: "/feedback", search: {} })}
          >
            {workTitle ?? "この制作物"}
          </M3eInputChip>
        ) : null}
        <span className="spacer" />
        {compact ? null : (
          <M3eButton variant="filled" onClick={() => setCreating(true)}>
            <M3eIcon slot="icon" name="add_comment" />
            スレッドを立てる
          </M3eButton>
        )}
      </div>
      {threads === undefined ? (
        <p className="muted">読み込み中…</p>
      ) : threads.length === 0 ? (
        <div className="empty">
          <M3eIcon name="forum" />
          <span className="title-medium">まだスレッドがありません</span>
          <span className="muted">
            作っている案を出して、意図や迷っている点を相談できます。「スレッドを立てる」から始めます
          </span>
        </div>
      ) : (
        <M3eActionList className="list" aria-label="スレッド">
          {threads.map((t) => (
            <M3eListAction
              key={t.id}
              className={`list__item ${t.unread ? "list__item--unread" : ""}`}
              onClick={() =>
                void navigate({ to: "/feedback/$threadId", params: { threadId: t.id } })
              }
            >
              {t.unread ? (
                <span slot="leading" className="dash__unread" aria-label="未読" role="img" />
              ) : (
                <M3eIcon slot="leading" name="forum" />
              )}
              <span slot="overline">
                {t.workTitle}
                {t.confidentiality === "restricted" ? "（非公開）" : ""}
              </span>
              <span className="list__headline">{t.title}</span>
              <span slot="supporting-text">
                {t.lastPost ? `${t.lastPost.authorName}: ${t.lastPost.excerpt}` : ""}
              </span>
              <span slot="trailing" className="meta">
                {formatJstShort(t.lastPostAt)}・{t.postCount} 件
              </span>
            </M3eListAction>
          ))}
        </M3eActionList>
      )}
      <NewThreadDialog
        open={creating === true}
        onClose={() => setCreating(false)}
        {...(work ? { workId: work } : {})}
      />
    </div>
  );
}
