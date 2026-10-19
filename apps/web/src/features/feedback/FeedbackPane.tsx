import { api } from "@mf100/convex/api";
import { formatFigmaPlace, formatVideoSpan, type Anchor } from "@mf100/domain";
import { webPlaceLabel } from "@/features/annotation/webBridge";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { formatJstCompact } from "@/lib/format";
import { useWindowClass } from "@/lib/useMedia";
import { Field, TextInput } from "@/ui/Field";
import { Loading } from "@/ui/Loading";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eActionList, M3eListAction } from "@m3e/react/list";
import { FeedbackComposer } from "./FeedbackComposer";
import { FeedbackConversation } from "./FeedbackConversation";
import { FeedbackThreadMenu } from "./FeedbackThreadMenu";

export type FeedbackThreadSummary = FunctionReturnType<typeof api.feedback.listThreads>[number];

/** 紙面のどこか（一覧・スレッドの見出しに出す短い説明） */
export function anchorPlace(anchor: Anchor | null): string | null {
  if (!anchor) return null;
  switch (anchor.type) {
    case "pdf_rect":
    case "pdf_pin":
      return `p.${anchor.page}`;
    case "image_rect":
    case "image_pin":
      return "画像の上";
    case "text_range": {
      const q = anchor.quote.replace(/\s+/g, " ").trim();
      return `「${q.length > 16 ? `${q.slice(0, 15)}…` : q}」`;
    }
    case "video_time":
      return formatVideoSpan(anchor);
    case "web_element":
      return webPlaceLabel(anchor);
    case "figma_node":
      return formatFigmaPlace(anchor);
    case "external":
      return null;
  }
}

/**
 * エディタの引き出し「相談」（FB）。利用者決定 2026-10-15: コメントは指摘して解決するもの、相談は解決しない話し合い。
 * 制作物の中で相談の一覧・やり取り・新しい相談まで完結させる（全画面のフィードバックへ移らない）。
 * 紙面で範囲を選んで「相談」を選んでも始められる。その相談は紙面に番号付きの印（secondary の角丸の四角）で出る。
 */
export function FeedbackPane({
  workId,
  revisionId,
  threads,
  indexOf,
  openId,
  onOpen,
  onShowPlace,
  intro,
  expandable = true,
}: {
  workId: string;
  /** 表示中の版（新しい相談はこの版についてのものとして立てる） */
  revisionId: string | null;
  threads: FeedbackThreadSummary[] | undefined;
  /** 表示中の版の紙面に印がある相談の番号 */
  indexOf: ReadonlyMap<string, number>;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onShowPlace: (t: { id: string; anchor: Anchor | null; revisionId: string | null }) => void;
  /** 一覧の上の説明 */
  intro?: string;
  /** スレッドの見出しに「大きく開く」を出す（FB スペースの中では出さない） */
  expandable?: boolean;
}) {
  const [starting, setStarting] = useState(false);
  if (openId)
    return (
      <FeedbackPaneThread
        threadId={openId}
        index={indexOf.get(openId) ?? null}
        onBack={() => onOpen(null)}
        onShowPlace={onShowPlace}
        expandable={expandable}
      />
    );
  return (
    <div className="fb-pane">
      <div className="fb-pane__intro">
        {intro ? <p className="fb-pane__lead">{intro}</p> : null}
        {starting ? null : (
          <M3eButton variant="tonal" onClick={() => setStarting(true)}>
            <M3eIcon slot="icon" name="add_comment" />
            相談を始める
          </M3eButton>
        )}
      </div>
      {starting ? (
        <NewPaneThread
          workId={workId}
          revisionId={revisionId}
          onCancel={() => setStarting(false)}
          onCreated={(id) => {
            setStarting(false);
            onOpen(id);
          }}
        />
      ) : null}
      {threads === undefined ? (
        <Loading size="small" label="相談を読み込んでいます" />
      ) : threads.length === 0 ? (
        <p className="muted fb-pane__empty">まだ相談はありません</p>
      ) : (
        <M3eActionList className="list fb-pane__list" aria-label="相談">
          {threads.map((t) => {
            const n = indexOf.get(t.id);
            const place = anchorPlace(t.anchor as Anchor | null);
            return (
              <M3eListAction
                key={t.id}
                className={`list__item ${t.unread ? "list__item--unread" : ""}`}
                onClick={() => {
                  onOpen(t.id);
                  if (t.anchor)
                    onShowPlace({
                      id: t.id,
                      anchor: t.anchor as Anchor,
                      revisionId: t.revision?.id ?? null,
                    });
                }}
              >
                {n ? (
                  <span
                    slot="leading"
                    className="fb-mark"
                    aria-label={`紙面の相談 ${n}`}
                    role="img"
                  >
                    {n}
                  </span>
                ) : (
                  <M3eIcon slot="leading" name="forum" />
                )}
                <span slot="overline">
                  {[t.revision?.label, place].filter(Boolean).join("・") || "制作物について"}
                </span>
                <span className="list__headline">{t.title}</span>
                {t.lastPost ? (
                  <span slot="supporting-text">
                    {t.lastPost.authorName}: {t.lastPost.excerpt}
                  </span>
                ) : null}
                <span slot="trailing" className="meta">
                  {t.unread ? <span className="dash__unread" role="img" aria-label="未読" /> : null}
                  {formatJstCompact(t.lastPostAt)}
                </span>
              </M3eListAction>
            );
          })}
        </M3eActionList>
      )}
    </div>
  );
}

function NewPaneThread({
  workId,
  revisionId,
  onCancel,
  onCreated,
}: {
  workId: string;
  revisionId: string | null;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const create = useMutation(api.feedback.createThread);
  const [title, setTitle] = useState("");
  return (
    <div className="fb-pane__new">
      <Field label="題名" hint="省くと本文の 1 行目になります">
        <TextInput value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <FeedbackComposer
        workId={workId}
        label="相談の内容"
        submitLabel="相談を始める"
        autoFocus
        onSubmit={async (r) => {
          const id = await create({
            workId,
            ...(title.trim() ? { title: title.trim() } : {}),
            ...(revisionId ? { revisionId } : {}),
            body: r.body,
            mentions: r.mentions,
            fileIds: r.fileIds,
            ...(r.template ? { template: r.template } : {}),
          });
          onCreated(id);
        }}
      />
      <div className="row">
        <M3eButton variant="text" onClick={onCancel}>
          やめる
        </M3eButton>
      </div>
    </div>
  );
}

function FeedbackPaneThread({
  threadId,
  index,
  onBack,
  onShowPlace,
  expandable,
}: {
  threadId: string;
  index: number | null;
  expandable: boolean;
  onBack: () => void;
  onShowPlace: (t: { id: string; anchor: Anchor | null; revisionId: string | null }) => void;
}) {
  const data = useQuery(api.feedback.getThread, { threadId });
  const compact = useWindowClass() === "compact";
  const place = data ? anchorPlace(data.thread.anchor as Anchor | null) : null;
  return (
    <div className="fb-pane fb-pane--thread">
      <div className="fb-pane__head">
        <M3eIconButton aria-label="相談の一覧へ戻る" onClick={onBack}>
          <M3eIcon name="arrow_back" />
        </M3eIconButton>
        <div className="fb-pane__heading">
          <span className="fb-pane__title">
            {data ? data.thread.title : <Loading inline label="相談を読み込んでいます" />}
          </span>
          {data ? (
            <span className="fb-pane__sub">
              {[data.thread.revision?.label, place].filter(Boolean).join("・") || "制作物について"}
            </span>
          ) : null}
        </div>
        {data ? (
          <FeedbackThreadMenu threadId={threadId} canDelete={data.can.delete} onDeleted={onBack} />
        ) : null}
        {expandable ? (
          <Link
            to="/feedback/$threadId"
            params={{ threadId }}
            className="fb-pane__expand"
            aria-label="大きく開く"
            title="大きく開く"
          >
            <M3eIcon name="open_in_full" />
          </Link>
        ) : null}
      </div>
      {data?.thread.anchor ? (
        <M3eButton
          variant="text"
          className="fb-pane__place"
          onClick={() =>
            onShowPlace({
              id: threadId,
              anchor: data.thread.anchor as Anchor,
              revisionId: data.thread.revision?.id ?? null,
            })
          }
        >
          <M3eIcon slot="icon" name="location_on" />
          紙面の場所を表示{index ? `（${index}）` : ""}
        </M3eButton>
      ) : null}
      {data === undefined ? null : data === null ? (
        <p className="muted fb-pane__empty">この相談は見つからないか、見る権限がありません</p>
      ) : (
        <FeedbackConversation threadId={threadId} data={data} dense={compact} />
      )}
    </div>
  );
}
