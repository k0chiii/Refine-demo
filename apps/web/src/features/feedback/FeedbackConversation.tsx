import { api } from "@mf100/convex/api";
import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { FeedbackComposer } from "./FeedbackComposer";
import { FeedbackPost, type ThreadData } from "./FeedbackPost";

/**
 * 相談（FB）のやり取り: 投稿（古い順）と返信欄。全画面（/feedback/:id）とエディタの FB タブで同じものを使う。
 * 開いたら既読にする（新しい投稿が来たときも）。新しい投稿が来たら一番下へ。
 */
export function FeedbackConversation({
  threadId,
  data,
}: {
  threadId: string;
  data: NonNullable<ThreadData>;
}) {
  const post = useMutation(api.feedback.post);
  const markRead = useMutation(api.feedback.markRead);
  const endRef = useRef<HTMLDivElement>(null);
  const count = data.posts.length;
  useEffect(() => {
    void markRead({ threadId }).catch(() => undefined);
  }, [threadId, count]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [threadId, count]);
  const people = data.posts.filter((p) => !p.deleted).map((p) => p.author);
  return (
    <>
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
                threadId,
                body: r.body,
                mentions: r.mentions,
                fileIds: r.fileIds,
                ...(r.template ? { template: r.template } : {}),
              });
            }}
          />
        </div>
      ) : null}
    </>
  );
}
