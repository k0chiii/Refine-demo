import { api } from "@mf100/convex/api";
import type { Anchor } from "@mf100/domain";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { FeedbackConversation } from "@/features/feedback/FeedbackConversation";
import { anchorPlace } from "@/features/feedback/FeedbackPane";
import { FeedbackThreadMenu } from "@/features/feedback/FeedbackThreadMenu";
import { useVisualViewportBox } from "@/lib/useKeyboardInset";
import { useWindowClass } from "@/lib/useMedia";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Loading } from "@/ui/Loading";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";

export const Route = createFileRoute("/_app/feedback/$threadId")({
  component: FeedbackThread,
});

/**
 * フィードバック（FB）のスレッド（Slack のスレッドに当たる）。通知・リンクから開く入口。
 * 840 以上は、その制作物の FB スペース（紙面とスレッドを並べる画面）でこのスレッドを開き直す。
 * 839 以下はここで全画面のやり取りを出す（返信欄を下に止める。Slack と同じ）。
 */
function FeedbackThread() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const wc = useWindowClass();
  const wide = wc === "expanded" || wc === "large";
  const compact = wc === "compact";
  // スマホは Slack のスレッドと同じ形（画面の高さに収め、返信欄を下に固定。キーボードではページを動かさない）
  useVisualViewportBox(compact);
  const data = useQuery(api.feedback.getThread, { threadId: threadId });

  // 広い画面: その制作物の FB スペースで開き直す（紙面を見ながら話せる画面）
  useEffect(() => {
    if (wide && data)
      void navigate({
        to: "/feedback/w/$workId",
        params: { workId: data.work.id },
        search: { thread: threadId },
        replace: true,
      });
  }, [wide, data?.work.id, threadId]);

  const backToWork = () =>
    void (data
      ? navigate({ to: "/feedback/w/$workId", params: { workId: data.work.id }, search: {} })
      : navigate({ to: "/feedback" }));
  const back = (
    <AppBarSlot slot="leading">
      <M3eIconButton aria-label="この制作物の FB へ戻る" onClick={backToWork}>
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

  if (wide)
    return (
      <>
        <AppBarSlot slot="title">フィードバック</AppBarSlot>
        {data === null ? (
          <div className="empty">このスレッドは見つからないか、見る権限がありません</div>
        ) : (
          <p className="muted">開いています…</p>
        )}
      </>
    );

  const where = data
    ? [data.thread.revision?.label, anchorPlace(data.thread.anchor as Anchor | null)]
        .filter(Boolean)
        .join("・") || "制作物について"
    : "";
  return (
    <>
      {back}
      <AppBarSlot slot="title" {...(data ? { title: data.thread.title } : {})}>
        {data ? data.thread.title : "フィードバック"}
      </AppBarSlot>
      {data ? <AppBarSlot slot="subtitle">{data.work.title}</AppBarSlot> : null}
      {data === undefined ? (
        <Loading label="相談を読み込んでいます" />
      ) : data === null ? (
        <div className="empty">このスレッドは見つからないか、見る権限がありません</div>
      ) : (
        <div className="fb-thread">
          <FeedbackConversation
            threadId={threadId}
            data={data}
            dense={compact}
            header={
              <section className="fb-context" aria-label="相談している制作物">
                <M3eIcon
                  name={data.thread.anchor ? "location_on" : "description"}
                  className="fb-context__icon"
                />
                <div className="fb-context__text">
                  <span className="fb-context__work">
                    {data.work.title}
                    {data.work.confidentiality === "restricted" ? "（非公開）" : ""}
                  </span>
                  <span className="fb-context__where">
                    {where}・参加 {data.thread.participants.length} 人
                  </span>
                </div>
                <FeedbackThreadMenu
                  threadId={threadId}
                  canDelete={data.can.delete}
                  onDeleted={backToWork}
                />
                {data.work.canOpen ? (
                  <M3eButton variant="tonal" onClick={openInWork}>
                    <M3eIcon slot="icon" name="open_in_new" />
                    {data.thread.anchor ? "紙面で見る" : "制作物で見る"}
                  </M3eButton>
                ) : null}
              </section>
            }
          />
        </div>
      )}
    </>
  );
}
