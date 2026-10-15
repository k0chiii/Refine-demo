import { api } from "@mf100/convex/api";
import { FEEDBACK_REACTIONS, feedbackTemplates } from "@mf100/domain";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { renderWithMentions, type MentionUser } from "@/features/review/mentions";
import { formatJstShort } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { TextArea } from "@/ui/Field";
import {
  M3eButton,
  M3eDialog,
  M3eFilterChip,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
} from "@/ui/m3e";
import { UserAvatar } from "@/ui/UserAvatar";
import { FeedbackFiles } from "./FeedbackFiles";

export type ThreadData = FunctionReturnType<typeof api.feedback.getThread>;
export type PostData = NonNullable<ThreadData>["posts"][number];

/**
 * FB スレッドの 1 投稿（Slack のメッセージに当たる）。アバター・名前・時刻・本文・添付・リアクション。
 * ⋮ から自分の投稿を直す・消す（消した投稿は「削除された投稿」として残す）。
 * リアクションは決まった絵文字だけ（FEEDBACK_REACTIONS）。自分が付けたものは選択中のチップ。
 */
/** リアクションの名前（メニューの項目と読み上げ） */
const reactionNames: Record<string, string> = {
  "👍": "いいね",
  "🙏": "ありがとう",
  "👀": "見ました",
  "🎉": "おめでとう",
  "💡": "ひらめき",
  "❤️": "好き",
};

export function FeedbackPost({ post, people }: { post: PostData; people: readonly MentionUser[] }) {
  const toggle = useMutation(api.feedback.toggleReaction);
  const edit = useMutation(api.feedback.editPost);
  const remove = useMutation(api.feedback.deletePost);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const react = useAction(async (emoji: string) => {
    await toggle({ postId: post.id, emoji });
  });
  const save = useAction(async () => {
    if (editing === null) return;
    // 直すのは本文だけ（メンションは今のまま。新しい「@名前」は投稿し直して呼ぶ）
    await edit({ postId: post.id, body: editing });
    setEditing(null);
  });
  const doDelete = useAction(async () => {
    await remove({ postId: post.id });
    setConfirmDelete(false);
  });
  const menuId = `fb-post-menu-${post.id}`;
  const reactId = `fb-react-${post.id}`;
  const template = post.template ? feedbackTemplates.find((t) => t.id === post.template) : null;

  if (post.deleted)
    return (
      <article className="fb-post fb-post--deleted" aria-label="削除された投稿">
        <span className="fb-post__avatar" aria-hidden="true">
          <M3eIcon name="delete" />
        </span>
        <p className="muted small">削除された投稿</p>
      </article>
    );

  return (
    <article className="fb-post" aria-label={`${post.author.name} の投稿`}>
      <span className="fb-post__avatar" aria-hidden="true">
        <UserAvatar seed={post.author.id} size={36} />
      </span>
      <div className="fb-post__main">
        <header className="fb-post__head">
          <span className="fb-post__name">{post.author.name}</span>
          <time className="fb-post__time" dateTime={new Date(post.createdAt).toISOString()}>
            {formatJstShort(post.createdAt)}
            {post.editedAt ? "（編集済み）" : ""}
          </time>
          {template ? <span className="fb-post__tpl">{template.label}</span> : null}
          <span className="spacer" />
          {post.can.edit || post.can.delete ? (
            <>
              <M3eIconButton aria-label="投稿の操作" className="fb-post__more">
                <M3eIcon name="more_vert" />
                <M3eMenuTrigger htmlFor={menuId} />
              </M3eIconButton>
              <M3eMenu id={menuId} positionX="before">
                {post.can.edit ? (
                  <M3eMenuItem onClick={() => setEditing(post.body)}>
                    <M3eIcon slot="icon" name="edit" />
                    編集
                  </M3eMenuItem>
                ) : null}
                {post.can.delete ? (
                  <M3eMenuItem onClick={() => setConfirmDelete(true)}>
                    <M3eIcon slot="icon" name="delete" />
                    削除
                  </M3eMenuItem>
                ) : null}
              </M3eMenu>
            </>
          ) : null}
        </header>
        {editing !== null ? (
          <div className="fb-post__edit">
            <TextArea
              aria-label="投稿を編集"
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              rows={4}
              autoFocus
            />
            <div className="row">
              <span className="spacer" />
              <M3eButton variant="text" onClick={() => setEditing(null)}>
                キャンセル
              </M3eButton>
              <M3eButton variant="filled" disabled={save.pending} onClick={() => void save.run()}>
                保存
              </M3eButton>
            </div>
          </div>
        ) : post.body ? (
          <div className="fb-post__body">
            {renderWithMentions(post.body, [...post.mentions, ...people])}
          </div>
        ) : null}
        <FeedbackFiles files={post.files} />
        <div className="fb-post__reactions" role="group" aria-label="リアクション">
          {post.reactions.map((r) => (
            <M3eFilterChip
              key={r.emoji}
              selected={r.mine}
              aria-label={`${r.emoji} ${r.count} 人${r.mine ? "（自分も）" : ""}`}
              onClick={() => void react.run(r.emoji)}
            >
              {r.emoji} {r.count}
            </M3eFilterChip>
          ))}
          <M3eIconButton aria-label="リアクションを付ける" className="fb-post__add-reaction">
            <M3eIcon name="add_reaction" />
            <M3eMenuTrigger htmlFor={reactId} />
          </M3eIconButton>
          <M3eMenu id={reactId} className="fb-react-menu">
            {FEEDBACK_REACTIONS.map((e) => {
              // 項目に名前を添え、自分が付けたものに印（M3 Menus: 選択は色以外でも示す）
              const mine = post.reactions.some((r) => r.emoji === e && r.mine);
              return (
                <M3eMenuItem key={e} onClick={() => void react.run(e)}>
                  {mine ? <M3eIcon slot="icon" name="check" /> : null}
                  {e} {reactionNames[e] ?? ""}
                </M3eMenuItem>
              );
            })}
          </M3eMenu>
        </div>
      </div>
      <M3eDialog open={confirmDelete} onClosed={() => setConfirmDelete(false)} closeLabel="閉じる">
        <span slot="header">投稿を削除しますか？</span>
        <div className="dialog-body">
          <p>「削除された投稿」として残り、本文と添付は見えなくなります。元に戻せません</p>
        </div>
        <div slot="actions" className="row">
          <span className="spacer" />
          <M3eButton variant="text" onClick={() => setConfirmDelete(false)}>
            キャンセル
          </M3eButton>
          <M3eButton variant="text" disabled={doDelete.pending} onClick={() => void doDelete.run()}>
            削除
          </M3eButton>
        </div>
      </M3eDialog>
    </article>
  );
}
