import { api } from "@mf100/convex/api";
import type { Anchor } from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useWindowClass } from "@/lib/useMedia";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { M3eButton, M3eIcon, M3eIconButton } from "@/ui/m3e";
import { FeedbackPane } from "./FeedbackPane";
import { FeedbackSpaceList } from "./FeedbackSpaceList";
import { FeedbackStage, feedbackMarks } from "./FeedbackStage";

/**
 * フィードバック（FB）の画面。制作物ごとに 1 つの FB スペースがあり、その中に紙面の範囲についてのスレッドと
 * 制作物全体についてのスレッドが立つ（利用者決定 2026-10-16）。
 * - 広い画面（1200 以上）: 縦に 3 列。左に FB スペース（制作物）の一覧、中央に紙面、右にスレッド（一覧 → やり取り）
 * - 840–1199: スペースを開くと 紙面 と スレッド の 2 列（スペースの一覧へは戻るボタン）
 * - 839 以下: スペースの一覧 → スレッドの一覧 → やり取り（全画面）。紙面は「制作物を開く」から
 * 紙面ではコメント（校正の指摘）は出さず、FB の印だけ。範囲を選ぶとその場所の FB スレッドを立てられる。
 */
export function FeedbackSpaceView({ workId, threadId }: { workId?: string; threadId?: string }) {
  const navigate = useNavigate();
  const wc = useWindowClass();
  const large = wc === "large";
  const twoPane = wc === "expanded";
  const narrow = wc === "compact" || wc === "medium";
  const spaces = useQuery(api.feedback.listSpaces, {});
  const space = workId ? spaces?.find((s) => s.workId === workId) : undefined;
  const threads = useQuery(api.feedback.listThreads, workId ? { workId } : "skip");

  // 紙面に出す版: 選んだ版 → 開いたスレッドの版 → 最新の版
  const [revChoice, setRevChoice] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ anchor: Anchor; at: number } | null>(null);
  useEffect(() => {
    setRevChoice(null);
    setFocus(null);
  }, [workId]);
  const showPlace = (t: { anchor: Anchor | null; revisionId: string | null }) => {
    if (t.revisionId) setRevChoice(t.revisionId);
    if (t.anchor) setFocus({ anchor: t.anchor, at: Date.now() });
  };
  // スレッドを開いたら、紙面をその版・場所へ
  const opened = threadId ? threads?.find((t) => t.id === threadId) : undefined;
  useEffect(() => {
    if (opened)
      showPlace({
        anchor: opened.anchor as Anchor | null,
        revisionId: opened.revision?.id ?? null,
      });
  }, [opened?.id]);
  const revisionId = revChoice ?? space?.latestRevision?.id ?? null;
  const marks = feedbackMarks(threads, revisionId);

  const openSpace = (id: string) =>
    void navigate({ to: "/feedback/w/$workId", params: { workId: id }, search: {} });
  const openThread = (id: string | null) => {
    if (!workId) return;
    // 狭い画面はスレッドを全画面で開く（Slack と同じ。返信欄を下に止める画面）
    if (id && narrow) {
      void navigate({ to: "/feedback/$threadId", params: { threadId: id } });
      return;
    }
    void navigate({
      to: "/feedback/w/$workId",
      params: { workId },
      search: id ? { thread: id } : {},
    });
  };

  const list = (
    <FeedbackSpaceList {...(workId ? { selectedWorkId: workId } : {})} onOpen={openSpace} />
  );
  const threadsPane = workId ? (
    <FeedbackPane
      workId={workId}
      revisionId={null}
      threads={threads}
      indexOf={marks}
      openId={threadId ?? null}
      onOpen={openThread}
      onShowPlace={showPlace}
      expandable={false}
      intro={
        narrow
          ? "この制作物についての相談・話し合い（解決はしません）。紙面の範囲についての FB は、制作物を開いて範囲を選ぶと立てられます"
          : "この制作物についての相談・話し合い（解決はしません）。紙面で範囲を選ぶと、その場所について立てられます"
      }
    />
  ) : null;
  const stage =
    workId && space ? (
      space.canOpen ? (
        <FeedbackStage
          workId={workId}
          revisionId={revisionId}
          onRevision={setRevChoice}
          threads={threads}
          activeId={threadId ?? null}
          onSelectThread={(id) => openThread(id)}
          onCreated={(id) => openThread(id)}
          focus={focus}
        />
      ) : (
        <div className="empty fb-stage__empty">
          <M3eIcon name="lock" />
          この制作物の紙面を見る権限がありません。FB は読み書きできます
        </div>
      )
    ) : (
      <div className="empty fb-stage__empty">
        <M3eIcon name="forum" />
        <span className="title-medium">制作物を選ぶと、紙面とスレッドが開きます</span>
        <span className="muted">制作物ごとに 1 つの FB スペースがあります</span>
      </div>
    );

  const title = space ? space.title : "フィードバック";
  const appBar = (
    <>
      {workId && !large ? (
        <AppBarSlot slot="leading">
          <M3eIconButton
            aria-label="FB スペースの一覧へ戻る"
            onClick={() => void navigate({ to: "/feedback" })}
          >
            <M3eIcon name="arrow_back" className="icon--mirror" />
          </M3eIconButton>
        </AppBarSlot>
      ) : null}
      <AppBarSlot slot="title" {...(workId ? { title } : {})}>
        {workId && !large ? title : "フィードバック"}
      </AppBarSlot>
      {workId && narrow && space?.canOpen ? (
        <AppBarSlot slot="actions">
          <M3eButton
            variant="text"
            onClick={() => void navigate({ to: "/works/$workId", params: { workId } })}
          >
            <M3eIcon slot="icon" name="open_in_new" />
            紙面
          </M3eButton>
        </AppBarSlot>
      ) : null}
    </>
  );

  if (narrow)
    return (
      <>
        {appBar}
        {workId ? <div className="fb-space-narrow">{threadsPane}</div> : list}
      </>
    );
  if (twoPane && !workId)
    return (
      <>
        {appBar}
        <div className="fb-space fb-space--list">
          <div className="fb-space__pane fb-space__spaces">{list}</div>
          <div className="fb-space__pane">{stage}</div>
        </div>
      </>
    );
  return (
    <>
      {appBar}
      <div className={`fb-space ${large ? "fb-space--three" : "fb-space--two"}`}>
        {large ? <div className="fb-space__pane fb-space__spaces">{list}</div> : null}
        <div className="fb-space__pane fb-space__stage">{stage}</div>
        <div className="fb-space__pane fb-space__threads">
          {workId ? (
            <>
              <header className="fb-space__head">
                <span className="fb-space__title">{title}</span>
                {space ? (
                  <span className="fb-space__sub">
                    スレッド {space.threads}
                    {space.unread ? `・未読 ${space.unread}` : ""}
                  </span>
                ) : null}
              </header>
              {threadsPane}
            </>
          ) : (
            <div className="empty fb-stage__empty">
              <M3eIcon name="chat" />
              スレッドはここに出ます
            </div>
          )}
        </div>
      </div>
    </>
  );
}
