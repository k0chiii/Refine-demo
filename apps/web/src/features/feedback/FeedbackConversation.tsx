import { api } from "@mf100/convex/api";
import { useMutation } from "convex/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { FeedbackComposer } from "./FeedbackComposer";
import { FeedbackPost, type ThreadData } from "./FeedbackPost";
import { buildTimeline, type TimelineItem } from "./timeline";

/**
 * 相談（FB）のやり取り: 投稿（古い順）と返信欄。全画面（/feedback/:id）とエディタの FB タブで同じものを使う。
 * 開いたら既読にする（新しい投稿が来たときも）。開いたときは「ここから未読」の線（無ければ一番下）まで送る。
 * 投稿は日付で区切り、同じ人が続けて書いたものはまとめる（timeline.ts。Slack・Gmail と同じ）。
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
  const unreadRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = data.posts.length;
  // 開いた時点の「前に読んだ時刻」を覚えておく（開くとすぐ既読にするので、その後の値では未読が分からない）
  const opened = useRef<{ threadId: string; readAt: number | null } | null>(null);
  if (opened.current?.threadId !== threadId) opened.current = { threadId, readAt: data.readAt };
  const readAtOnOpen = opened.current.readAt;
  const timeline = useMemo(
    () =>
      buildTimeline(
        data.posts.map((p) => ({ ...p, mine: p.can.edit })),
        { readAt: readAtOnOpen, now: Date.now() },
      ),
    [data.posts, readAtOnOpen],
  );
  // 開いたとき・新しい投稿が来たときに既読にする。すでに最後の投稿まで読んでいれば呼ばない
  // （読み済みのスレッドを開き直すたびに既読の行を書き換えると、一覧・スレッドの購読が無駄に再実行される）
  const upToDate = data.readAt !== null && data.readAt >= data.thread.lastPostAt;
  useEffect(() => {
    if (upToDate) return;
    void markRead({ threadId }).catch(() => undefined);
  }, [threadId, count, upToDate]);
  // 開いたとき: 未読の線があればそこへ、無ければ一番下へ。その後に投稿が増えたら一番下へ
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (scrolledFor.current !== threadId) {
      scrolledFor.current = threadId;
      if (unreadRef.current) {
        unreadRef.current.scrollIntoView({ block: "start" });
        return;
      }
    }
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
          {/* 日付ごとにまとめる（日付の札はその日の投稿が見えている間だけ上に止まる。札が重ならない） */}
          {dayGroups(timeline).map((g) => (
            <div key={g.key} className="fb-day-group">
              {g.label ? (
                // 区切りは見た目の手がかり（日時は各投稿の見出しの time で読める）
                <div className="fb-day" aria-hidden="true">
                  <span className="fb-day__label">{g.label}</span>
                </div>
              ) : null}
              {g.items.map((item) =>
                item.type === "unread" ? (
                  <div key={item.key} ref={unreadRef} className="fb-unread" aria-hidden="true">
                    <span className="fb-unread__label">ここから未読</span>
                  </div>
                ) : item.type === "post" ? (
                  <FeedbackPost
                    key={item.key}
                    post={item.post}
                    people={people}
                    continued={item.continued}
                  />
                ) : null,
              )}
            </div>
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

/** 並びを日付ごとの塊に分ける（日付の区切りで新しい塊。未読の線は直前の塊の末尾＝次の日付の直前に入る） */
function dayGroups<P>(items: TimelineItem<P>[]) {
  const groups: Array<{ key: string; label: string | null; items: TimelineItem<P>[] }> = [];
  for (const item of items) {
    if (item.type === "day") groups.push({ key: item.key, label: item.label, items: [] });
    else {
      if (groups.length === 0) groups.push({ key: "head", label: null, items: [] });
      groups.at(-1)!.items.push(item);
    }
  }
  return groups;
}
