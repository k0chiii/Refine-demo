import { api } from "@mf100/convex/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { FeedbackComposer } from "@/features/feedback/FeedbackComposer";
import { FeedbackPost } from "@/features/feedback/FeedbackPost";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { M3eButton, M3eIcon, M3eIconButton } from "@/ui/m3e";

export const Route = createFileRoute("/_app/feedback/$threadId")({ component: FeedbackThread });

/**
 * フィードバックのスレッド（Slack のスレッドに当たる）。投稿が古い順に並び、下の欄から返信する。
 * 開いたら既読にする（新しい投稿が来たときも）。制作物を見られる人には、制作物を開くボタン。
 */
function FeedbackThread() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const data = useQuery(api.feedback.getThread, { threadId: threadId });
  const post = useMutation(api.feedback.post);
  const markRead = useMutation(api.feedback.markRead);
  const endRef = useRef<HTMLDivElement>(null);
  const count = data?.posts.length ?? 0;
  useEffect(() => {
    if (!data) return;
    void markRead({ threadId: threadId }).catch(() => undefined);
  }, [threadId, count]);
  // 新しい投稿が来たら一番下へ（最初に開いたときも）
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const back = (
    <AppBarSlot slot="leading">
      <M3eIconButton
        aria-label="フィードバックへ戻る"
        onClick={() => void navigate({ to: "/feedback" })}
      >
        <M3eIcon name="arrow_back" className="icon--mirror" />
      </M3eIconButton>
    </AppBarSlot>
  );
  if (data === undefined)
    return (
      <>
        {back}
        <p className="muted">読み込み中…</p>
      </>
    );
  if (data === null)
    return (
      <>
        {back}
        <AppBarSlot slot="title">フィードバック</AppBarSlot>
        <div className="empty">このスレッドは見つからないか、見る権限がありません</div>
      </>
    );
  const people = data.posts.filter((p) => !p.deleted).map((p) => p.author);
  return (
    <div className="fb-thread">
      {back}
      <AppBarSlot slot="title" title={data.thread.title}>
        {data.thread.title}
      </AppBarSlot>
      <AppBarSlot slot="subtitle">{data.work.title}</AppBarSlot>
      {data.work.canOpen ? (
        <AppBarSlot slot="actions">
          <M3eButton
            variant="text"
            onClick={() =>
              void navigate({ to: "/works/$workId", params: { workId: data.work.id } })
            }
          >
            <M3eIcon slot="icon" name="open_in_new" />
            制作物を開く
          </M3eButton>
        </AppBarSlot>
      ) : null}
      <div className="fb-thread__posts" role="feed" aria-label={`「${data.thread.title}」の投稿`}>
        {data.posts.map((p) => (
          <FeedbackPost key={p.id} post={p} people={people} />
        ))}
        <div ref={endRef} />
      </div>
      {data.can.post ? (
        <div className="fb-thread__composer">
          <FeedbackComposer
            workId={data.work.id}
            label="返信"
            submitLabel="送信"
            onSubmit={async (r) => {
              await post({
                threadId: threadId,
                body: r.body,
                mentions: r.mentions,
                fileIds: r.fileIds,
                ...(r.template ? { template: r.template } : {}),
              });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
