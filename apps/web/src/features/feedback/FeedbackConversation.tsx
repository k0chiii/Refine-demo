import { api } from "@mf100/convex/api";
import { useMutation } from "convex/react";
import { type ReactNode, useEffect, useRef } from "react";
import { FeedbackComposer } from "./FeedbackComposer";
import { FeedbackPost, type ThreadData } from "./FeedbackPost";

/**
 * 相談（FB）のやり取り: 投稿（古い順）と返信欄。全画面（/feedback/:id）とエディタの FB タブで同じものを使う。
 * 開いたら既読にする（新しい投稿が来たときも）。新しい投稿が来たら一番下へ。
 * スマホのスレッド（dense）は Slack と同じく、投稿だけがスクロールし、返信欄は一番下に固定される（CSS の .shell--chat）。
 * そのときキーボードの出入りで投稿の欄が縮んでも、一番下を見ていたなら一番下のままにする。
 */
export function FeedbackConversation({
  threadId,
  data,
  header,
  dense = false,
}: {
  threadId: string;
  data: NonNullable<ThreadData>;
  /** 投稿の上に置くもの（何の相談か）。投稿と一緒にスクロールする */
  header?: ReactNode;
  dense?: boolean;
}) {
  const post = useMutation(api.feedback.post);
  const markRead = useMutation(api.feedback.markRead);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = data.posts.length;
  useEffect(() => {
    void markRead({ threadId }).catch(() => undefined);
  }, [threadId, count]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [threadId, count]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let atBottom = true;
    const onScroll = () => {
      atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    };
    const ro = new ResizeObserver(() => {
      if (atBottom) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);
  const people = data.posts.filter((p) => !p.deleted).map((p) => p.author);
  return (
    <>
      <div className="fb-thread__scroll" ref={scrollRef}>
        {header}
        <div className="fb-thread__posts" role="feed" aria-label={`「${data.thread.title}」の投稿`}>
          {data.posts.map((p) => (
            <FeedbackPost key={p.id} post={p} people={people} />
          ))}
          <div ref={endRef} />
        </div>
      </div>
      {data.can.post ? (
        <div className="fb-thread__composer">
          <FeedbackComposer
            workId={data.work.id}
            label="返信"
            submitLabel="送信"
            dense={dense}
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
