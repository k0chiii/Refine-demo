import {
  formatFigmaPlace,
  formatVideoSpan,
  THREAD_LATEST_REPLIES_SHOWN,
  type WebAnchorState,
} from "@mf100/domain";
import { webViewportLabel } from "@/features/annotation/webBridge";
import { formatJstShort } from "@/lib/format";
import { formatRelative } from "@/lib/relativeTime";
import { UserAvatar } from "@/ui/UserAvatar";
import { M3eAvatar } from "@m3e/react/avatar";
import { M3eButton } from "@m3e/react/button";
import { M3eCard } from "@m3e/react/card";
import { M3eIcon } from "@m3e/react/icon";
import { useRef, useState } from "react";
import { CommentAttachments } from "./CommentAttachments";
import { CommentBody } from "./CommentBody";
import { ThreadMeta } from "./ThreadMeta";
import { isClosed, type Thread } from "./thread";
import "./ThreadPanel.css";

export { closedResolutions, isClosed, type Thread } from "./thread";

/**
 * コメントの一覧のカード（Slack のスレッドの一覧のように、1 件を短く見せる）。
 * 投稿者・時刻・本文（3 行まで）・添付のサムネイル（最初の数枚）・状態、その下に直近の返信（Google ドキュメントのコメントのように
 * 最新の 3 件。アバター・名前・時刻・本文 3 行まで・添付）、返信がそれより多いときは「ほか n 件の返信」、最後に未読の点。
 * 押すとコメントを選んで紙面のピンへ移るだけで、カードは開かない。
 * 開く（返信・採否・担当・訂正・削除・リアクションなど全部）のは返信の欄か下の行から、スレッドのパネル（ThreadPanel）で。
 * 反映する／反映しない／次の版で対応のボタンは、選んだ（押した・キーボードでフォーカスした）カードにだけ出す
 * （Google ドキュメント・Filestage と同じく、操作は選んだ 1 件に。ほかのカードは状態の行だけ）。
 * 反映しない・次の版で対応は理由が要るので、スレッドのパネルをその入力欄を開いた状態で開く。
 */
export function ThreadCard({
  thread: t,
  active,
  canDecide,
  canReply,
  onSelect,
  onOpen,
  onResolve,
  onDecideStart,
  pending,
  className,
  index,
  placeState,
  now,
}: {
  /** 紙面のピンと同じ番号（ピンの名前「コメント N」と対応させる） */
  index?: number;
  /** Web のライブ表示での再アンカーの結果（moved: 文字で見つけた、detached: 位置が外れた） */
  placeState?: WebAnchorState;
  thread: Thread;
  active: boolean;
  canDecide: boolean;
  canReply: boolean;
  /** 制作物の機密区分（添付の写しを端末に残してよいかの判断） */
  /** 最後の返信の「n 分前」を数える現在時刻 */
  now: number;
  /** カードを押した（選んで位置へ移る。パネルは開かない） */
  onSelect: () => void;
  /** スレッドのパネルを開く */
  onOpen: () => void;
  onResolve: () => Promise<void>;
  /** 反映しない・次の版で対応（理由の欄を開いたパネルを開く） */
  onDecideStart: (mode: "rejected" | "deferred") => void;
  pending?: boolean;
  className?: string;
}) {
  const closed = isClosed(t);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  // 直近の返信（古い順）。見せきれない分は「ほか n 件の返信」
  const replies = t.latestReplies.slice(-THREAD_LATEST_REPLIES_SHOWN);
  const hidden = Math.max(0, t.replyCount - replies.length);
  // キーボードでカードの中にフォーカスがある間も、選んだのと同じに採否のボタンを出す
  const [focused, setFocused] = useState(false);
  const pressing = useRef(false);
  const showDecide = canDecide && !closed && (active || focused);
  return (
    <M3eCard
      variant="filled"
      className={`thread thread--compact ${active ? "thread--active" : ""} ${closed ? "thread--closed" : ""} ${t.unread ? "thread--unread" : ""} ${className ?? ""}`}
      aria-label={`コメント${index ? ` ${index}` : ""} ${t.author?.name ?? ""}`}
      data-thread-id={t.id}
      onClick={onSelect}
    >
      <div
        slot="content"
        className="thread__content"
        onPointerDown={() => (pressing.current = true)}
        onPointerUp={() => (pressing.current = false)}
        onPointerCancel={() => (pressing.current = false)}
        onFocus={() => {
          if (!pressing.current) setFocused(true);
        }}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (!next || !e.currentTarget.contains(next)) setFocused(false);
        }}
      >
        <div className="thread__head">
          {t.origin ? (
            <M3eAvatar className="thread__bot" aria-hidden="true">
              <M3eIcon name="smart_toy" />
            </M3eAvatar>
          ) : (
            <UserAvatar seed={t.author?.email ?? t.authorId} userId={t.authorId} size={28} />
          )}
          <div className="thread__who">
            <span className="thread__name">{t.author?.name}</span>
            <span className="thread__time">{formatJstShort(t.createdAt)}</span>
          </div>
          <span className="spacer" />
          {/* 位置のあるコメントは、紙面のピンと同じ番号のボタンから位置へ飛べる（カードを押すのはマウスだけの操作なので、
              キーボード・支援技術でも同じことができるようにする。§35 A-07） */}
          {index && t.anchor ? (
            <M3eButton
              variant="text"
              className="thread__index"
              aria-label={
                t.anchor.type === "video_time"
                  ? `コメント ${index} の時刻 ${formatVideoSpan(t.anchor)} を再生位置にする`
                  : t.anchor.type === "web_element"
                    ? `コメント ${index} の要素を表示（${webViewportLabel(t.anchor)} で付けたコメント）`
                    : t.anchor.type === "figma_node"
                      ? `コメント ${index} のフレームを表示`
                      : `コメント ${index} の位置を表示`
              }
              onClick={(e: Event) => {
                stop(e);
                onSelect();
              }}
            >
              <M3eIcon slot="icon" name="location_on" />
              {t.anchor.type === "video_time"
                ? `${index}・${formatVideoSpan(t.anchor)}`
                : t.anchor.type === "web_element"
                  ? `${index}・${webViewportLabel(t.anchor)}`
                  : t.anchor.type === "figma_node"
                    ? `${index}・${formatFigmaPlace(t.anchor)}`
                    : index}
            </M3eButton>
          ) : null}
        </div>
        {t.anchor?.type === "text_range" ? (
          <blockquote className="thread__quote thread__quote--clamp">
            「{t.anchor.quote}」
          </blockquote>
        ) : null}
        {t.anchor?.type === "web_element" && t.anchor.selector.textQuote ? (
          <blockquote className="thread__quote thread__quote--clamp">
            「{t.anchor.selector.textQuote.exact}」
          </blockquote>
        ) : null}
        <CommentBody
          className="thread__body thread__body--clamp"
          body={t.body}
          format={t.bodyFormat}
          mentionUsers={t.mentionUsers}
        />
        {t.files.length > 0 ? <CommentAttachments files={t.files} variant="thumbs" /> : null}
        <ThreadMeta thread={t} placeState={placeState} />
        {showDecide ? (
          <div className="thread__decide" role="group" aria-label="反映するかどうか" onClick={stop}>
            <M3eButton
              variant="filled"
              size="small"
              disabled={pending === true}
              onClick={() => void onResolve()}
            >
              <M3eIcon slot="icon" name="check" />
              反映する
            </M3eButton>
            <M3eButton variant="tonal" size="small" onClick={() => onDecideStart("rejected")}>
              <M3eIcon slot="icon" name="block" />
              反映しない
            </M3eButton>
            <M3eButton variant="text" size="small" onClick={() => onDecideStart("deferred")}>
              <M3eIcon slot="icon" name="move_down" />
              次の版で対応
            </M3eButton>
          </div>
        ) : null}
        {replies.length > 0 ? (
          <div
            className="thread__replylist"
            role="list"
            onClick={(e) => {
              stop(e);
              onOpen();
            }}
          >
            {replies.map((r) => (
              <div
                key={r.id}
                role="listitem"
                className={`thread__reply ${r.unread ? "thread__reply--unread" : ""}`}
                data-reply-id={r.id}
              >
                <UserAvatar seed={r.author?.email ?? r.authorId} userId={r.authorId} size={20} />
                <div className="thread__reply-main">
                  <div className="thread__reply-head">
                    <span className="thread__reply-name">{r.author?.name}</span>
                    <span className="thread__reply-time">{formatRelative(r.createdAt, now)}</span>
                  </div>
                  <CommentBody
                    className="thread__body thread__body--clamp"
                    body={r.body}
                    format={r.bodyFormat}
                    mentionUsers={r.mentionUsers}
                  />
                  {r.fileCount > 0 ? (
                    <div className="thread__reply-files">
                      {r.firstFile ? (
                        <CommentAttachments files={[r.firstFile]} variant="thumbs" />
                      ) : null}
                      {r.fileCount > 1 ? (
                        <span className="thread__reply-filecount">+{r.fileCount - 1}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="thread__footer"
          aria-label={
            t.replyCount > 0
              ? `${t.replyCount}件の返信。スレッドを開く${t.unread ? "（未読）" : ""}`
              : `スレッドを開く${t.unread ? "（未読）" : ""}`
          }
          onClick={(e) => {
            stop(e);
            onOpen();
          }}
        >
          {hidden > 0 ? (
            <span className="thread__replies">ほか {hidden} 件の返信</span>
          ) : t.replyCount > 0 ? (
            <span className="thread__replies">{t.replyCount}件の返信</span>
          ) : canReply ? (
            <span className="thread__replies">返信</span>
          ) : null}
          <span className="spacer" />
          {t.unread ? <span className="thread__unread" aria-hidden="true" /> : null}
          <M3eIcon name="chevron_right" className="icon--mirror thread__chevron" />
        </button>
      </div>
    </M3eCard>
  );
}
