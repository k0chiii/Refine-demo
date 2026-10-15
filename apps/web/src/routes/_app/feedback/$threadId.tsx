import { api } from "@mf100/convex/api";
import type { Anchor } from "@mf100/domain";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { FeedbackConversation } from "@/features/feedback/FeedbackConversation";
import { FeedbackListPane, validateFeedbackListSearch } from "@/features/feedback/FeedbackListPane";
import { anchorPlace } from "@/features/feedback/FeedbackPane";
import { useVisualViewportBox } from "@/lib/useKeyboardInset";
import { useWindowClass } from "@/lib/useMedia";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { M3eButton, M3eIcon, M3eIconButton } from "@/ui/m3e";

export const Route = createFileRoute("/_app/feedback/$threadId")({
  validateSearch: validateFeedbackListSearch,
  component: FeedbackThread,
});

/**
 * フィードバック（FB）のスレッド（Slack のスレッドに当たる）。投稿が古い順に並び、下の欄から返信する。
 * 広い画面は一覧・詳細（左に一覧を残す。M3 list-detail の例そのもの「メッセージと会話」）。
 * 上に何の制作物の相談かを示すカードを置き、「制作物で見る」で制作物の中の同じ相談（版・場所）へ移る。
 */
function FeedbackThread() {
  const { threadId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const wc = useWindowClass();
  const wide = wc === "expanded" || wc === "large";
  const compact = wc === "compact";
  // スマホは Slack のスレッドと同じ形（画面の高さに収め、返信欄を下に固定。キーボードではページを動かさない）
  useVisualViewportBox(compact);
  const data = useQuery(api.feedback.getThread, { threadId: threadId });

  const back = wide ? null : (
    <AppBarSlot slot="leading">
      <M3eIconButton
        aria-label="フィードバックへ戻る"
        onClick={() => void navigate({ to: "/feedback", search })}
      >
        <M3eIcon name="arrow_back" className="icon--mirror" />
      </M3eIconButton>
    </AppBarSlot>
  );
  const openInWork = () => {
    if (!data) return;
    const s = { tab: "feedback" as const, fb: threadId };
    const rev = data.thread.revision;
    void (rev
      ? navigate({
          to: "/works/$workId/v/$n",
          params: { workId: data.work.id, n: String(rev.number) },
          search: s,
        })
      : navigate({ to: "/works/$workId", params: { workId: data.work.id }, search: s }));
  };

  const detail =
    data === undefined ? (
      <p className="muted">読み込み中…</p>
    ) : data === null ? (
      <div className="empty">このスレッドは見つからないか、見る権限がありません</div>
    ) : (
      <div className="fb-thread">
        <FeedbackConversation
          threadId={threadId}
          data={data}
          dense={compact}
          header={
            <>
              <section className="fb-context" aria-label="相談している制作物">
                <M3eIcon
                  name={data.thread.anchor ? "my_location" : "description"}
                  className="fb-context__icon"
                />
                <div className="fb-context__text">
                  <span className="fb-context__work">
                    {data.work.title}
                    {data.work.confidentiality === "restricted" ? "（非公開）" : ""}
                  </span>
                  <span className="fb-context__where">
                    {[data.thread.revision?.label, anchorPlace(data.thread.anchor as Anchor | null)]
                      .filter(Boolean)
                      .join("・") || "制作物について"}
                    ・参加 {data.thread.participants.length} 人
                  </span>
                </div>
                {data.work.canOpen ? (
                  <M3eButton variant="tonal" onClick={openInWork}>
                    <M3eIcon slot="icon" name="open_in_new" />
                    {data.thread.anchor ? "紙面で見る" : "制作物で見る"}
                  </M3eButton>
                ) : null}
              </section>
              {wide ? <h2 className="fb-thread__title">{data.thread.title}</h2> : null}
            </>
          }
        />
      </div>
    );

  return (
    <>
      {back}
      <AppBarSlot slot="title" {...(data && !wide ? { title: data.thread.title } : {})}>
        {data && !wide ? data.thread.title : "フィードバック"}
      </AppBarSlot>
      {data && !wide ? <AppBarSlot slot="subtitle">{data.work.title}</AppBarSlot> : null}
      {wide ? (
        <div className="fb-layout">
          <div className="fb-layout__list">
            <FeedbackListPane search={search} selectedId={threadId} />
          </div>
          <div className="fb-layout__detail">{detail}</div>
        </div>
      ) : (
        detail
      )}
    </>
  );
}
